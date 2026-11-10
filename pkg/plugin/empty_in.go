package plugin

import "strings"

// Replacements for an empty IN-list. DuckDB rejects `IN ()` with
// "Parser Error: syntax error", which a multi-value "All" variable with zero
// options produces through Grafana's own formatters (e.g. ${var:singlequote}
// never reaches the datasource's interpolateVariable).
//
//	x IN ()      -> x IN (NULL)           NULL, matches no row. Arc's rollup router
//	                                      accepts it, so the query stays cube-served.
//	                                      Only correct when no NOT encloses it.
//	x IN ()      -> x IN (NULL) IS NOT NULL
//	                                      when a NOT keyword appears earlier in the
//	                                      statement: FALSE for every row, NULL
//	                                      included, so any enclosing NOT (`NOT x IN ()`,
//	                                      `NOT (x IN ())`, `NOT lower(x) IN ()`) yields
//	                                      TRUE. Arc's router rejects IS NOT NULL on this
//	                                      shape, but a query with a NOT is never
//	                                      cube-served anyway.
//	x NOT IN ()  -> x NOT IN (NULL) IS NULL
//	                                      `x NOT IN (NULL)` is NULL for every x
//	                                      (NULL included), so IS NULL is TRUE for
//	                                      every row: excluding nothing keeps all.
//	                                      Plain `NOT IN (NULL)` would drop all rows.
const (
	emptyInReplacement         = "(NULL)"
	emptyInUnderNotReplacement = "(NULL) IS NOT NULL"
	emptyNotInReplacement      = "(NULL) IS NULL"
)

type sqlEdit struct {
	start, end int
	repl       string
}

// fixEmptyInLists rewrites every empty `IN ()` / `NOT IN ()` list in sql
// (keywords case-insensitive, any whitespace or comments between tokens).
// String literals ('..', E'..', $tag$..$tag$), quoted identifiers and
// comments are skipped, so their contents are never modified.
func fixEmptyInLists(sql string) string {
	var edits []sqlEdit
	seenNot := false  // a NOT keyword token appeared earlier in the statement
	var toks []string // significant tokens so far: upper-cased bare words, "." or "?"
	n := len(sql)
	i := 0
	for i < n {
		c := sql[i]
		switch {
		case isSQLSpace(c):
			i++
			continue
		case isCommentStart(sql, i):
			i = skipComment(sql, i)
			continue
		case c == '\'':
			i = skipQuoted(sql, i, '\'', false)
		case c == '"':
			i = skipQuoted(sql, i, '"', false)
		case c == '$':
			if end, ok := skipDollarQuoted(sql, i); ok {
				i = end
			} else {
				i++
			}
		case isIdentStart(c):
			j := i + 1
			for j < n && isIdentPart(sql[j]) {
				j++
			}
			word := sql[i:j]
			if j < n && sql[j] == '\'' && (word == "E" || word == "e") {
				i = skipQuoted(sql, j, '\'', true)
				toks = append(toks, "?")
				continue
			}
			if strings.EqualFold(word, "IN") {
				if open, closing, ok := emptyParens(sql, j); ok {
					repl := emptyInReplacement
					if n := len(toks); n > 0 && toks[n-1] == "NOT" {
						repl = emptyNotInReplacement
					} else if seenNot {
						repl = emptyInUnderNotReplacement
					}
					edits = append(edits, sqlEdit{start: open, end: closing + 1, repl: repl})
					i = closing + 1
					toks = append(toks, "?")
					continue
				}
			}
			if strings.EqualFold(word, "NOT") {
				seenNot = true
			}
			toks = append(toks, strings.ToUpper(word))
			i = j
			continue
		case c >= '0' && c <= '9':
			j := i + 1
			for j < n && (isIdentPart(sql[j]) || sql[j] == '.') {
				j++
			}
			i = j
		case c == '.':
			i++
			toks = append(toks, ".")
			continue
		default:
			i++
		}
		toks = append(toks, "?")
	}

	if len(edits) == 0 {
		return sql
	}
	var b strings.Builder
	b.Grow(len(sql) + len(edits)*len(emptyNotInReplacement))
	last := 0
	for _, e := range edits {
		b.WriteString(sql[last:e.start])
		b.WriteString(e.repl)
		last = e.end
	}
	b.WriteString(sql[last:])
	return b.String()
}

// emptyParens reports whether sql[from:] starts (after whitespace/comments)
// with `(` followed (after whitespace/comments) by `)`.
func emptyParens(sql string, from int) (open, closing int, ok bool) {
	open = skipInsignificant(sql, from)
	if open >= len(sql) || sql[open] != '(' {
		return 0, 0, false
	}
	closing = skipInsignificant(sql, open+1)
	if closing >= len(sql) || sql[closing] != ')' {
		return 0, 0, false
	}
	return open, closing, true
}

func skipInsignificant(sql string, i int) int {
	for i < len(sql) {
		switch {
		case isSQLSpace(sql[i]):
			i++
		case isCommentStart(sql, i):
			i = skipComment(sql, i)
		default:
			return i
		}
	}
	return i
}

func isCommentStart(sql string, i int) bool {
	if i+1 >= len(sql) {
		return false
	}
	return (sql[i] == '-' && sql[i+1] == '-') || (sql[i] == '/' && sql[i+1] == '*')
}

// skipComment returns the index just past the comment starting at i.
// Block comments nest, as in DuckDB's (PostgreSQL-derived) scanner.
func skipComment(sql string, i int) int {
	n := len(sql)
	if sql[i] == '-' {
		for i < n && sql[i] != '\n' {
			i++
		}
		return i
	}
	depth := 0
	for i < n {
		if i+1 < n && sql[i] == '/' && sql[i+1] == '*' {
			depth++
			i += 2
			continue
		}
		if i+1 < n && sql[i] == '*' && sql[i+1] == '/' {
			depth--
			i += 2
			if depth == 0 {
				return i
			}
			continue
		}
		i++
	}
	return n
}

// skipQuoted returns the index just past the quoted token opening at i.
// A doubled quote is an escaped quote; backslashEscapes handles E'..' strings.
// An unterminated token runs to the end of sql.
func skipQuoted(sql string, i int, quote byte, backslashEscapes bool) int {
	n := len(sql)
	i++
	for i < n {
		switch {
		case backslashEscapes && sql[i] == '\\':
			i += 2
		case sql[i] == quote:
			if i+1 < n && sql[i+1] == quote {
				i += 2
				continue
			}
			return i + 1
		default:
			i++
		}
	}
	return n
}

// skipDollarQuoted handles $$..$$ and $tag$..$tag$ strings starting at i.
func skipDollarQuoted(sql string, i int) (int, bool) {
	n := len(sql)
	j := i + 1
	if j < n && sql[j] != '$' {
		if !isIdentStart(sql[j]) {
			return 0, false
		}
		for j < n && sql[j] != '$' {
			if !isIdentPart(sql[j]) {
				return 0, false
			}
			j++
		}
	}
	if j >= n {
		return 0, false
	}
	tag := sql[i : j+1]
	end := strings.Index(sql[j+1:], tag)
	if end < 0 {
		return n, true
	}
	return j + 1 + end + len(tag), true
}

func isSQLSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'
}

func isIdentStart(c byte) bool {
	return c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c >= 0x80
}

func isIdentPart(c byte) bool {
	return isIdentStart(c) || (c >= '0' && c <= '9') || c == '$'
}
