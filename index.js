require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { getSheetsClient, ensureSheetAndHeaders, appendRowToSheet } = require('./sheets');

const app = express();
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
const SHEET_TITLE = 'rideshare';

// TrackDrive API configuration
const TRACKDRIVE_API_URL = 'https://ramonmarquez.trackdrive.com/api/v1/leads';
const LEAD_TOKEN = '74aae788dcb64a4c8c5328176bb6403a';

// Headers in the exact order requested for Google Sheets
const HEADERS = [
  'full_name',
  'phone',
  'email',
  'gender',
  'date_of_birth',
  'address',
  'city',
  'state',
  'postal_code',
  'country',
  'diagnosis',
  'date_of_exposure',
  'brief_description_of_your_situation',
  'tcpa_consent_given',
  'xxTrustedFormCertUrl',
  'current_date'
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
    
    // Build the TrackDrive API payload
    const trackdrivePayload = {
      lead_token: LEAD_TOKEN,
      ...Object.keys(FIELD_MAPPING).reduce((acc, formField) => {
        const apiField = FIELD_MAPPING[formField];
        const value = payload[formField];
        
        if (value !== null && value !== undefined && value !== '') {
          acc[apiField] = String(value);
        }
        
        return acc;
      }, {})
    };

    // Add static fields for TrackDrive
    if (payload.xxTrustedFormCertUrl) {
      trackdrivePayload.trusted_form_cert_url = payload.xxTrustedFormCertUrl;
    }

    // Add IP address if not provided
    if (!trackdrivePayload.ip_address) {
      trackdrivePayload.ip_address = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || '';
    }

    // Add source URL if not provided
    if (!trackdrivePayload.source_url) {
      trackdrivePayload.source_url = req.headers.referer || '';
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
      let value = payload[key];
      if (typeof value === 'boolean') return value ? 'true' : 'false';
      if (value === null || value === undefined) return '';
      return String(value);
    });

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

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});


