import React, { useState } from 'react';
import { CodeEditor } from '@grafana/ui';

interface VariableQuery {
  query: string;
}

interface VariableQueryProps {
  query: VariableQuery;
  onChange: (query: VariableQuery, definition: string) => void;
}

export const VariableQueryEditor: React.FC<VariableQueryProps> = ({ query, onChange }) => {
  const [state, setState] = useState(query);

  const saveQuery = (value: string) => {
    const updated = { ...state, query: value };
    setState(updated);
    onChange(updated, value);
  };

  return (
    <>
      <div style={{ marginBottom: '4px' }}>
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

      <div style={{ marginTop: '8px', paddingLeft: '8px' }}>
        <small style={{ color: '#6e6e6e', display: 'block', lineHeight: '1.6' }}>
          <strong>Examples:</strong>
          <br />
          • Get distinct hosts: <code style={{ fontSize: '12px' }}>SELECT DISTINCT host FROM telegraf.cpu ORDER BY host</code>
          <br />
          • Get tables: <code style={{ fontSize: '12px' }}>SHOW TABLES</code>
          <br />
          • Get databases: <code style={{ fontSize: '12px' }}>SHOW DATABASES</code>
        </small>
      </div>
    </>
  );
};
