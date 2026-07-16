import React, { useState, useRef } from 'react';

export default function FirmwareUpdateCard() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, uploading, success, error
  const [message, setMessage] = useState('');
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setStatus('idle');
      setMessage('');
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setStatus('uploading');
    setMessage('Uploading firmware...');

    const formData = new FormData();
    formData.append('firmware', file);

    try {
      // Use the current hostname so it works across the local network (not just localhost)
      const serverUrl = `http://${window.location.hostname}:8080/api/ota/upload`;
      
      const response = await fetch(serverUrl, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setStatus('success');
        setMessage(data.message || 'OTA Update Triggered successfully!');
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        setStatus('error');
        setMessage(data.error || 'Failed to upload firmware.');
      }
    } catch (error) {
      console.error('Upload error:', error);
      setStatus('error');
      setMessage('Network error while uploading.');
    }
  };

  return (
    <article className="telemetry-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div>
        <span style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>OTA Firmware Update</span>
        <div style={{ fontSize: '0.8rem', color: '#999', marginTop: '4px' }}>Upload .bin file for ESP32</div>
      </div>

      <input 
        type="file" 
        accept=".bin" 
        onChange={handleFileChange} 
        ref={fileInputRef}
        style={{ fontSize: '0.9rem', color: '#ccc' }}
      />
      
      <button 
        onClick={handleUpload} 
        disabled={!file || status === 'uploading'}
        style={{
          padding: '8px 12px',
          backgroundColor: file && status !== 'uploading' ? '#2563eb' : '#4b5563',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: file && status !== 'uploading' ? 'pointer' : 'not-allowed',
          fontWeight: 'bold',
          marginTop: '5px'
        }}
      >
        {status === 'uploading' ? 'Uploading...' : 'Update Firmware'}
      </button>
      
      {message && (
        <div style={{ 
          fontSize: '0.85rem',
          color: status === 'success' ? '#22c55e' : status === 'error' ? '#ef4444' : '#60a5fa'
        }}>
          {message}
        </div>
      )}
    </article>
  );
}
