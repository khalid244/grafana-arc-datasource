package plugin

import (
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func TestFixEmptyInLists(t *testing.T) {
	tests := []struct {
		name, in, want string
	}{
		{"in", "WHERE a IN ()", "WHERE a IN (NULL)"},
		{"not in", "WHERE a NOT IN ()", "WHERE a NOT IN (NULL) IS NULL"},
		{"lower case", "where a in ()", "where a in (NULL)"},
		{"mixed case not in", "where a nOt In ()", "where a nOt In (NULL) IS NULL"},
		{"no space before paren", "a IN()", "a IN(NULL)"},
		{"no space, not in", "a NOT IN()", "a NOT IN(NULL) IS NULL"},
		{"extra whitespace", "a  IN \n\t(  \n )", "a  IN \n\t(NULL)"},
		{"extra whitespace not in", "a\tNOT \r\n  IN\n(\t)", "a\tNOT \r\n  IN\n(NULL) IS NULL"},
		{"comment between tokens", "a NOT /* x */ IN -- y\n ( /* z */ )", "a NOT /* x */ IN -- y\n (NULL) IS NULL"},
		{
			"multiple occurrences",
			"x IN () AND y NOT IN () AND z IN ('a') AND w in ()",
			"x IN (NULL) AND y NOT IN (NULL) IS NULL AND z IN ('a') AND w in (NULL) IS NOT NULL",
		},
		{"non-empty untouched", "a IN ('x','y') AND b NOT IN (1, 2)", "a IN ('x','y') AND b NOT IN (1, 2)"},
		{"subquery untouched", "a IN (SELECT b FROM t)", "a IN (SELECT b FROM t)"},
		{"NOT paren", "NOT (a IN ())", "NOT (a IN (NULL) IS NOT NULL)"},
		{"NOT paren no space", "WHERE NOT(a IN ())", "WHERE NOT(a IN (NULL) IS NOT NULL)"},
		{"prefix NOT", "WHERE NOT x IN ()", "WHERE NOT x IN (NULL) IS NOT NULL"},
		{"prefix NOT dotted", "WHERE a AND NOT t.x IN () AND y IN ()", "WHERE a AND NOT t.x IN (NULL) IS NOT NULL AND y IN (NULL) IS NOT NULL"},
		{"prefix NOT quoted", `WHERE NOT "x" IN ()`, `WHERE NOT "x" IN (NULL) IS NOT NULL`},
		{"prefix NOT function", "WHERE NOT lower(x) IN ()", "WHERE NOT lower(x) IN (NULL) IS NOT NULL"},
		{"NOT NOT IN", "WHERE a OR b AND x NOT IN () OR NOT y IN ()", "WHERE a OR b AND x NOT IN (NULL) IS NULL OR NOT y IN (NULL) IS NOT NULL"},
		{"notes column is not NOT", "WHERE notes IN () AND not_x IN () AND x_not IN ()", "WHERE notes IN (NULL) AND not_x IN (NULL) AND x_not IN (NULL)"},
		{"NOT in literal or comment ignored", "WHERE n = 'NOT' /* NOT */ AND b IN () -- NOT\n AND c IN ()", "WHERE n = 'NOT' /* NOT */ AND b IN (NULL) -- NOT\n AND c IN (NULL)"},
		{"unrelated NOT before plain IN", "WHERE NOT z AND b IN ()", "WHERE NOT z AND b IN (NULL) IS NOT NULL"},
		{"NOT(x IN ()) and plain mix", "WHERE a IN () AND NOT(b IN ()) OR c IN ()", "WHERE a IN (NULL) AND NOT(b IN (NULL) IS NOT NULL) OR c IN (NULL) IS NOT NULL"},
		{"NOT earlier in expr", "NOT a = 1 AND b IN ()", "NOT a = 1 AND b IN (NULL) IS NOT NULL"},
		{"word containing IN", "SELECT min(), join_in (), x_in (), INTERVAL ()", "SELECT min(), join_in (), x_in (), INTERVAL ()"},
		{"quoted identifier named IN", `SELECT "IN" () FROM t`, `SELECT "IN" () FROM t`},
		{"single-quoted literal", "WHERE note = 'a IN ()' AND b IN ()", "WHERE note = 'a IN ()' AND b IN (NULL)"},
		{"literal with escaped quote", "WHERE n = 'it''s NOT IN ()' AND b IN ()", "WHERE n = 'it''s NOT IN ()' AND b IN (NULL)"},
		{"escape string", `WHERE n = E'x\' IN ()' AND b IN ()`, `WHERE n = E'x\' IN ()' AND b IN (NULL)`},
		{"double-quoted identifier", `SELECT "col IN ()" FROM t WHERE b IN ()`, `SELECT "col IN ()" FROM t WHERE b IN (NULL)`},
		{"dollar-quoted string", "SELECT $$ IN () $$, $t$ NOT IN () $t$ WHERE b IN ()", "SELECT $$ IN () $$, $t$ NOT IN () $t$ WHERE b IN (NULL)"},
		{"line comment", "SELECT 1 -- WHERE a IN ()\nWHERE b IN ()", "SELECT 1 -- WHERE a IN ()\nWHERE b IN (NULL)"},
		{"block comment", "SELECT 1 /* a NOT IN () */ WHERE b IN ()", "SELECT 1 /* a NOT IN () */ WHERE b IN (NULL)"},
		{"nested block comment", "/* x /* y */ IN () */ b IN ()", "/* x /* y */ IN () */ b IN (NULL)"},
		{"unterminated literal", "WHERE a = 'IN ()", "WHERE a = 'IN ()"},
		{"no IN at all", "SELECT count(*) FROM t", "SELECT count(*) FROM t"},
		{"empty", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := fixEmptyInLists(tt.in)
			if got != tt.want {
				t.Fatalf("fixEmptyInLists(%q)\n got: %q\nwant: %q", tt.in, got, tt.want)
			}
			if again := fixEmptyInLists(got); again != got {
				t.Fatalf("not idempotent: %q -> %q", got, again)
			}
		})
	}
}

// The prod panel (2026-10-20): every multi-value "All" variable expanded to
// nothing through ${var:singlequote}, and Arc answered every panel with HTTP 500.
const prodEmptyVariablesSQL = "SELECT survey_name, count(*) FROM posthog.events WHERE event='survey sent' " +
	"AND survey_name IN () AND os_name IN () AND app_version IN () AND $__timeFilter(time) GROUP BY survey_name"

func TestApplyMacrosRewritesEmptyInLists(t *testing.T) {
	tr := backend.TimeRange{
		From: time.Date(2026, 10, 13, 0, 0, 0, 0, time.UTC),
		To:   time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC),
	}
	want := "SELECT survey_name, count(*) FROM posthog.events WHERE event='survey sent' " +
		"AND survey_name IN (NULL) AND os_name IN (NULL) AND app_version IN (NULL) " +
		"AND time >= '2026-10-13T00:00:00Z' AND time < '2026-10-20T00:00:00Z' GROUP BY survey_name"

	if got := ApplyMacros(prodEmptyVariablesSQL, tr, time.Hour); got != want {
		t.Errorf("ApplyMacros:\n got: %s\nwant: %s", got, want)
	}

	chunk := backend.TimeRange{From: tr.From, To: tr.From.Add(24 * time.Hour)}
	got := ApplyMacrosWithSplit(prodEmptyVariablesSQL, chunk, tr, time.Hour)
	if strings.Contains(got, "IN ()") || strings.Count(got, "IN (NULL)") != 3 || strings.Contains(got, "IS NOT NULL") {
		t.Errorf("ApplyMacrosWithSplit left an empty IN list: %s", got)
	}
}
