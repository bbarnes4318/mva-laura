require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { getSheetsClient, ensureSheetAndHeaders, appendRowToSheet } = require('./sheets');
const path = require('path'); // Added for serving static files

const app = express();

// CORS middleware to handle cross-origin requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
const SHEET_TITLE = 'rideshare';

// TrackDrive API configuration
const TRACKDRIVE_API_URL = 'https://ramonmarquez.trackdrive.com/api/v1/leads';
const LEAD_TOKEN = '74aae788dcb64a4c8c5328176bb6403a';

// Headers for Google Sheets - exact fields specified
const HEADERS = [
  'first_name',
  'last_name',
  'caller_id',
  'email',
  'address',
  'city',
  'state',
  'zip',
  'accident_date',
  'ip_address',
  'source_url',
  'trusted_form_cert_url',
  'tcpa_opt_in',
  'lead_token'
];

// Field mapping from form to TrackDrive API
const FIELD_MAPPING = {
  first_name: 'first_name',
  last_name: 'last_name',
  caller_id: 'caller_id',
  email: 'email',
  address: 'address',
  city: 'city',
  state: 'state',
  zip: 'zip',
  accident_date: 'accident_date',
  ip_address: 'ip_address',
  source_url: 'source_url',
  trusted_form_cert_url: 'trusted_form_cert_url',
  tcpa_opt_in: 'tcpa_opt_in'
};

let sheetReady = false;

// Serve the landing page at root
app.get('/', (req, res) => {
  console.log('Serving landing page from:', path.join(__dirname, 'sample-form.html'));
  res.sendFile(path.join(__dirname, 'sample-form.html'));
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/debug/env', (_req, res) => {
  const required = ['GOOGLE_SHEETS_ID','GOOGLE_PROJECT_ID','GOOGLE_CLIENT_EMAIL','GOOGLE_PRIVATE_KEY','TRACKDRIVE_API_KEY'];
  const status = {};
  for (const k of required) {
    const present = !!(process.env[k] && String(process.env[k]).trim() !== '');
    status[k] = present ? 'OK' : 'MISSING';
  }
  res.json(status);
});

app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body || {};
    
    console.log('Received payload:', JSON.stringify(payload, null, 2));
    
    // Filter out extra TrustedForm fields we don't need
    const cleanPayload = {};
    Object.keys(payload).forEach(key => {
      if (!key.startsWith('xxTrustedForm') || key === 'xxTrustedFormCertUrl') {
        cleanPayload[key] = payload[key];
      }
    });
    
    console.log('Cleaned payload:', JSON.stringify(cleanPayload, null, 2));
    
    // Build the TrackDrive API payload
    const trackdrivePayload = {
      lead_token: LEAD_TOKEN,
      ip_address: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || '',
      source_url: 'https://mva-laura-i3vvi.ondigitalocean.app/',
      ...Object.keys(FIELD_MAPPING).reduce((acc, formField) => {
        const apiField = FIELD_MAPPING[formField];
        const value = cleanPayload[formField];
        
        if (value !== null && value !== undefined && value !== '') {
          // Convert tcpa_opt_in to Yes/No format
          if (formField === 'tcpa_opt_in') {
            acc[apiField] = value === '1' || value === true || value === 'true' ? 'Yes' : 'No';
          } else {
            acc[apiField] = String(value);
          }
        }
        
        return acc;
      }, {})
    };

    // Add TrustedForm certificate URL
    if (cleanPayload.xxTrustedFormCertUrl) {
      trackdrivePayload.trusted_form_cert_url = cleanPayload.xxTrustedFormCertUrl;
    }

    console.log('Sending to TrackDrive API:', JSON.stringify(trackdrivePayload, null, 2));

    // Send to TrackDrive API
    const trackdriveResponse = await axios.post(TRACKDRIVE_API_URL, trackdrivePayload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.TRACKDRIVE_API_KEY}`,
        'User-Agent': 'MVA-Laura-Webhook/1.0'
      },
      timeout: 10000 // 10 second timeout
    });

    console.log('TrackDrive API response:', trackdriveResponse.status, trackdriveResponse.data);

    // Build the row for Google Sheets in the exact headers order
    const row = HEADERS.map((key) => {
      let value = cleanPayload[key];
      
      // Handle special mappings for Google Sheets
      if (key === 'trusted_form_cert_url' && !value) {
        value = cleanPayload.xxTrustedFormCertUrl; // Map Trusted Form field
      }
      if (key === 'lead_token' && !value) {
        value = LEAD_TOKEN; // Add the static lead token
      }
      if (key === 'ip_address' && !value) {
        value = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || '';
      }
      if (key === 'source_url' && !value) {
        value = 'https://mva-laura-i3vvi.ondigitalocean.app/';
      }
      
      // Convert tcpa_opt_in to Yes/No format for sheets
      if (key === 'tcpa_opt_in' && value) {
        value = value === '1' || value === true || value === 'true' ? 'Yes' : 'No';
      }
      
      if (typeof value === 'boolean') return value ? 'Yes' : 'No';
      if (value === null || value === undefined) return '';
      return String(value);
    });

    console.log('Google Sheets row:', JSON.stringify(row, null, 2));

    // Send to Google Sheets
    const sheets = await getSheetsClient();

    if (!sheetReady) {
      await ensureSheetAndHeaders(sheets, SHEET_TITLE, HEADERS);
      sheetReady = true;
    }

    await appendRowToSheet(sheets, SHEET_TITLE, row);

    console.log('Google Sheets: Row appended successfully');

    res.json({ 
      success: true, 
      trackdrive_response: trackdriveResponse.data,
      lead_id: trackdriveResponse.data.lead_id || trackdriveResponse.data.id,
      sheets_status: 'Row appended successfully'
    });

  } catch (err) {
    console.error('Webhook error:', err);
    
    let errorMessage = 'Internal Server Error';
    let statusCode = 500;
    let trackdriveError = null;
    let sheetsError = null;
    
    if (err.response) {
      // TrackDrive API error response
      statusCode = err.response.status;
      errorMessage = `TrackDrive API Error: ${err.response.status} - ${err.response.statusText}`;
      trackdriveError = err.response.data;
      console.error('TrackDrive API error details:', err.response.data);
    } else if (err.request) {
      // Network error
      errorMessage = 'Network Error: Unable to reach TrackDrive API';
      trackdriveError = 'Network error';
    } else {
      // Other error (likely Google Sheets)
      errorMessage = err.message || 'Unknown error occurred';
      sheetsError = err.message;
    }

    res.status(statusCode).json({ 
      success: false, 
      error: errorMessage,
      trackdrive_error: trackdriveError,
      sheets_error: sheetsError
    });
  }
});

// Add a test endpoint to verify the payload structure
app.post('/test-webhook', (req, res) => {
  const payload = req.body || {};
  
  // Filter out extra TrustedForm fields we don't need
  const cleanPayload = {};
  Object.keys(payload).forEach(key => {
    if (!key.startsWith('xxTrustedForm') || key === 'xxTrustedFormCertUrl') {
      cleanPayload[key] = payload[key];
    }
  });
  
  // Build the TrackDrive API payload (without actually sending)
  const trackdrivePayload = {
    lead_token: LEAD_TOKEN,
    ip_address: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || '',
    source_url: 'https://mva-laura-i3vvi.ondigitalocean.app/',
    ...Object.keys(FIELD_MAPPING).reduce((acc, formField) => {
      const apiField = FIELD_MAPPING[formField];
      const value = cleanPayload[formField];
      
      if (value !== null && value !== undefined && value !== '') {
        // Convert tcpa_opt_in to Yes/No format
        if (formField === 'tcpa_opt_in') {
          acc[apiField] = value === '1' || value === true || value === 'true' ? 'Yes' : 'No';
        } else {
          acc[apiField] = String(value);
        }
      }
      
      return acc;
    }, {})
  };

  // Add TrustedForm certificate URL
  if (cleanPayload.xxTrustedFormCertUrl) {
    trackdrivePayload.trusted_form_cert_url = cleanPayload.xxTrustedFormCertUrl;
  }

  res.json({
    original_payload: payload,
    cleaned_payload: cleanPayload,
    trackdrive_payload: trackdrivePayload,
    headers: req.headers,
    ip: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || '',
    referer: req.headers.referer || ''
  });
});

app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: 'Available endpoints:',
    endpoints: {
      'GET /': 'Landing page (MVA form)',
      'POST /webhook': 'Submit form data to TrackDrive API and Google Sheets',
      'POST /test-webhook': 'Test endpoint to verify payload structure (no actual submission)',
      'GET /health': 'Health check',
      'GET /debug/env': 'Check environment variables'
    },
    requested_url: req.url
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});


