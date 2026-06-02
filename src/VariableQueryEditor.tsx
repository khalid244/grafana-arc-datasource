import React, { useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { CodeEditor, useStyles2 } from '@grafana/ui';

interface VariableQuery {
  query: string;
}

interface VariableQueryProps {
  query: VariableQuery;
  onChange: (query: VariableQuery, definition: string) => void;
}

export const VariableQueryEditor: React.FC<VariableQueryProps> = ({ query, onChange }) => {
  const [state, setState] = useState(query);
  const styles = useStyles2(getStyles);

  const saveQuery = (value: string) => {
    const updated = { ...state, query: value };
    setState(updated);
    onChange(updated, value);
  };

  return (
    <>
      <div className={styles.labelRow}>
        <label className="gf-form-label">Query</label>
      </div>
      <CodeEditor
        language="sql"
        value={state.query || ''}
        onBlur={saveQuery}
        onSave={saveQuery}
        height="100px"
        showMiniMap={false}
        showLineNumbers={true}
        monacoOptions={{ wordWrap: 'on', scrollBeyondLastLine: false }}
      />

      <div className={styles.examples}>
        <small className={styles.hint}>
          <strong>Examples:</strong>
          <br />
          • Get distinct hosts: <code className={styles.code}>SELECT DISTINCT host FROM telegraf.cpu ORDER BY host</code>
          <br />
          • Get tables: <code className={styles.code}>SHOW TABLES</code>
          <br />
          • Get databases: <code className={styles.code}>SHOW DATABASES</code>
        </small>
      </div>
    </>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  labelRow: css({ marginBottom: theme.spacing(0.5) }),
  examples: css({ marginTop: theme.spacing(1), paddingLeft: theme.spacing(1) }),
  // Muted helper text on the theme grid (was hardcoded #6e6e6e + inline styles).
  hint: css({ color: theme.colors.text.secondary, display: 'block', lineHeight: 1.6 }),
  code: css({ fontSize: theme.typography.bodySmall.fontSize }),
});
