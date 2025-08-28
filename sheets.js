const { google } = require('googleapis');

const REQUIRED_ENVS = ['GOOGLE_SHEETS_ID', 'GOOGLE_PROJECT_ID', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY'];

function assertEnv() {
  const missing = REQUIRED_ENVS.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

async function getSheetsClient() {
  assertEnv();

  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  
  // Handle different key formats
  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }
  
  // Strip quotes if present
  if ((privateKey.startsWith('"') && privateKey.endsWith('"')) || 
      (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
    privateKey = privateKey.slice(1, -1);
  }

  // Ensure the private key has proper formatting
  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    // If it's a raw key, wrap it properly
    privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID,
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  return sheets;
}

async function getSpreadsheet(sheets) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const { data } = await sheets.spreadsheets.get({ spreadsheetId });
  return data;
}

async function findSheetByTitle(sheets, title) {
  const spreadsheet = await getSpreadsheet(sheets);
  const sheet = (spreadsheet.sheets || []).find((s) => s.properties && s.properties.title === title);
  return sheet ? sheet.properties : null;
}

async function createSheetIfMissing(sheets, title) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const existing = await findSheetByTitle(sheets, title);
  if (existing) return existing;

  const { data } = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title,
              gridProperties: { rowCount: 1000, columnCount: 26 },
            },
          },
        },
      ],
    },
  });
  const replies = data.replies || [];
  const added = replies[0]?.addSheet?.properties || null;
  return added;
}

async function ensureHeaderRow(sheets, title, headers) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const range = `${title}!1:1`;
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const existing = data.values && data.values[0];
  if (!existing || existing.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers],
      },
    });
    return;
  }
  // If headers exist but differ, replace to enforce exact order
  const serializedExisting = JSON.stringify(existing);
  const serializedExpected = JSON.stringify(headers);
  if (serializedExisting !== serializedExpected) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers],
      },
    });
  }
}

async function ensureSheetAndHeaders(sheets, title, headers) {
  await createSheetIfMissing(sheets, title);
  await ensureHeaderRow(sheets, title, headers);
}

async function appendRowToSheet(sheets, title, row) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const range = `${title}!A:A`;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

module.exports = {
  getSheetsClient,
  ensureSheetAndHeaders,
  appendRowToSheet,
};


