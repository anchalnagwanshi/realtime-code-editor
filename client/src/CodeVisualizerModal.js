// client/src/CodeVisualizerModal.js

import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';

// This is the main modal component
export default function CodeVisualizerModal({ trace, code, language, onClose }) {
  const [currentStep, setCurrentStep] = useState(0);
  const editorRef = useRef(null);
  const [decorations, setDecorations] = useState([]);
  const monacoRef = useRef(null); // Ref to store monaco instance

  // Ensure trace is an array, otherwise default to an empty array
  const safeTrace = Array.isArray(trace) ? trace : [];
  const currentTraceStep = safeTrace[currentStep];
  const totalSteps = safeTrace.length > 0 ? safeTrace.length - 1 : 0;

  // This effect handles highlighting the correct line in the editor
  useEffect(() => {
    if (editorRef.current && monacoRef.current && currentTraceStep) {
      const line = currentTraceStep.line;
      const monaco = monacoRef.current;

      let newDecorations = [];
      
      // Add "next line to be executed" color (yellow)
      if (line) {
         newDecorations.push({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: 'visualizer-next-line',
          },
        });
      }

      // Add "currently executed line" (blue) for the previous step
      if (currentStep > 0 && safeTrace[currentStep - 1]) {
        const prevLine = safeTrace[currentStep - 1].line;
        if (prevLine) {
            newDecorations.push({
            range: new monaco.Range(prevLine, 1, prevLine, 1),
            options: {
              isWholeLine: true,
              className: 'visualizer-executed-line',
            },
          });
        }
      }
      
      // We use setDecorations to apply the highlights
      setDecorations(editorRef.current.deltaDecorations(decorations, newDecorations));
      
      // And reveal the line
      if (line) {
        editorRef.current.revealLineInCenter(line);
      }
    }
  }, [currentStep, currentTraceStep, safeTrace, decorations]); // `decorations` is needed to clear old ones

  function handleEditorDidMount(editor, monaco) {
    editorRef.current = editor;
    monacoRef.current = monaco; // Store monaco instance

    // Define the custom highlight colors
    monaco.editor.defineTheme('visualizerTheme', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.lineHighlightBackground': '#00000000', // Remove default line highlight
      },
    });
    monaco.editor.setTheme('visualizerTheme');
  }

  // Helper component to render the stack frames and variables
  const StackRenderer = ({ stack }) => {
    if (!stack || stack.length === 0) {
      return <div style={{padding: '10px', color: '#8b949e'}}>Loading program...</div>;
    }
    return (
      <div style={{ padding: '10px' }}>
        {stack.map((frame, index) => (
          <div key={index} style={{ border: '1px solid #444', borderRadius: '5px', marginBottom: '10px' }}>
            <h4 style={{ margin: 0, padding: '8px', backgroundColor: '#333', borderTopLeftRadius: '5px', borderTopRightRadius: '5px' }}>
              {frame.func_name}
            </h4>
            <div style={{ padding: '8px' }}>
              <p style={{ fontSize: '0.8em', color: '#8b949e', margin: '0 0 5px 0' }}>Line: {frame.line}</p>
              {frame.encoded_locals && Object.keys(frame.encoded_locals).length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ border: '1px solid #444', padding: '5px', textAlign: 'left' }}>Variable</th>
                      <th style={{ border: '1px solid #444', padding: '5px', textAlign: 'left' }}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(frame.encoded_locals).map(([name, value]) => (
                      <tr key={name}>
                        <td style={{ border: '1px solid #444', padding: '5px', fontFamily: 'monospace' }}>{name}</td>
                        <td style={{ border: '1px solid #444', padding: '5px', fontFamily: 'monospace' }}>
                          {JSON.stringify(value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ fontSize: '0.9em', color: '#8b949e' }}>(No local variables)</p>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };
  
  // Render output
  const OutputRenderer = ({ output }) => {
    if (!output || output.length === 0) return null;
    return (
      <div style={{ padding: '0 10px 10px 10px' }}>
        <h4 style={{ margin: '0 0 5px 0' }}>stdout</h4>
        <pre style={{
          backgroundColor: '#0d1117', border: '1px solid #444', borderRadius: '5px',
          padding: '10px', margin: 0, color: 'white', whiteSpace: 'pre-wrap',
          wordBreak: 'break-all'
        }}>
          {output.join('')}
        </pre>
      </div>
    );
  };

  if (!currentTraceStep) {
    return <div style={{ padding: '20px' }}>Loading visualization trace...</div>
  }

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', flexDirection: 'column' }}>
      
      {/* 2-Column Layout for Editor and Data */}
      <div style={{ display: 'flex', flexGrow: 1, minHeight: '60vh' }}>
        {/* Column 1: Code */}
        <div style={{ width: '50%', borderRight: '1px solid #30363d', display: 'flex', flexDirection: 'column' }}>
          <Editor
            height="100%"
            language={language}
            theme="vs-dark"
            value={code}
            onMount={handleEditorDidMount}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 14,
              wordWrap: 'on',
              scrollBeyondLastLine: false,
            }}
          />
        </div>
        
        {/* Column 2: Data (Functions/Objects) */}
        <div style={{ width: '50%', overflowY: 'auto' }}>
          <h3 style={{ padding: '10px', margin: 0, borderBottom: '1px solid #30363d' }}>Functions & Objects</h3>
          <StackRenderer stack={currentTraceStep.stack_to_render} />
          <OutputRenderer output={currentTraceStep.stdout} />
        </div>
      </div>

      {/* Controls Area */}
      <div style={{
        padding: '10px',
        borderTop: '1px solid #30363d',
        backgroundColor: '#21262d',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <button onClick={() => setCurrentStep(0)} disabled={currentStep === 0}>Start</button>
          <button onClick={() => setCurrentStep(s => s - 1)} disabled={currentStep === 0}>Prev Step</button>
          
          <span style={{ flexShrink: 0 }}>Step {currentStep + 1} of {totalSteps + 1}</span>
          
          <input
            type="range"
            min="0"
            max={totalSteps}
            value={currentStep}
            onChange={(e) => setCurrentStep(Number(e.target.value))}
            style={{ flexGrow: 1 }}
          />
          
          <button onClick={() => setCurrentStep(s => s + 1)} disabled={currentStep === totalSteps}>Next Step</button>
          <button onClick={() => setCurrentStep(totalSteps)} disabled={currentStep === totalSteps}>End</button>
        </div>
      </div>
    </div>
  );
}