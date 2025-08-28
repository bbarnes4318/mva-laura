# MVA Laura - Dual Webhook (TrackDrive + Google Sheets)

This application exposes a JSON webhook that receives form data and sends it to BOTH the TrackDrive API for lead processing AND Google Sheets for data storage.

## Features

- Receives form submissions via POST to `/webhook`
- Sends data to TrackDrive API at `https://ramonmarquez.trackdrive.com/api/v1/leads`
- Saves data to Google Sheets in the `rideshare` sheet
- Includes Trusted Form certificate URL support
- Automatic IP address and source URL detection
- Comprehensive error handling and logging for both services

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create a `.env` file** with all required credentials:
   ```
   # TrackDrive API
   TRACKDRIVE_API_KEY=your_trackdrive_api_key_here
   
   # Google Sheets
   GOOGLE_SHEETS_ID=your_google_sheets_id_here
   GOOGLE_PROJECT_ID=your_google_project_id_here
   GOOGLE_CLIENT_EMAIL=your_service_account_email_here
   GOOGLE_PRIVATE_KEY=your_private_key_here
   
   # Server Configuration
   PORT=5000
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

## API Endpoints

### POST /webhook
Receives form data and forwards it to both TrackDrive API and Google Sheets.

**Required fields:**
- `first_name`
- `last_name` 
- `caller_id` (phone number)
- `email`

**Optional fields:**
- `address`
- `city`
- `state`
- `zip`
- `accident_date`
- `ip_address`
- `source_url`
- `trusted_form_cert_url`
- `tcpa_opt_in`

**Static fields:**
- `lead_token`: `74aae788dcb64a4c8c5328176bb6403a`

### GET /health
Health check endpoint.

### GET /debug/env
Check environment variable configuration.

## Data Flow

1. **Form Submission** → Webhook receives data
2. **TrackDrive API** → Sends lead data for processing
3. **Google Sheets** → Saves data to `rideshare` sheet for record keeping

## Form Integration

### Trusted Form Setup

1. Add the Trusted Form script to your HTML form:
   ```html
   <script type="text/javascript">
     (function() {
         var field = 'xxTrustedFormCertUrl';
         var provideReferrer = false;
         var invertFieldSensitivity = false;
         var tf = document.createElement('script');
         tf.type = 'text/javascript'; tf.async = true;
         tf.src = 'http' + ('https:' == document.location.protocol ? 's' : '') +
           '://api.trustedform.com/trustedform.js?provide_referrer=' + escape(provideReferrer) + '&field=' + escape(field) + '&l='+new Date().getTime()+Math.random() + '&invert_field_sensitivity=' + invertFieldSensitivity;
         var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(tf, s); }
     )();
   </script>
   ```

2. Add a hidden field for the Trusted Form certificate:
   ```html
   <input type="hidden" name="xxTrustedFormCertUrl" id="xxTrustedFormCertUrl">
   ```

3. Add the callback function (replace `NEW_FIELD_ID` with your actual field ID):
   ```html
   <script>
   function trustedFormCertUrlCallback(certificateUrl) {
       document.getElementById('xxTrustedFormCertUrl').value = certificateUrl;
       document.getElementById('xxTrustedFormCertUrl').dispatchEvent(new Event("input"));
   }
   </script>
   ```

### Form Submission

Submit form data to the webhook endpoint:
```javascript
fetch('/webhook', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
    body: JSON.stringify(formData)
});
```

## Response Format

**Success:**
```json
{
    "success": true,
    "trackdrive_response": {...},
    "lead_id": "12345",
    "sheets_status": "Row appended successfully"
}
```

**Error:**
```json
{
    "success": false,
    "error": "Error message",
    "trackdrive_error": {...},
    "sheets_error": "sheets error message"
}
```

## Testing

Use the included `sample-form.html` to test the webhook functionality locally.

## Deployment

This application can be deployed to any Node.js hosting platform (Heroku, Vercel, Railway, etc.).

Make sure to set all required environment variables in your deployment environment:
- `TRACKDRIVE_API_KEY`
- `GOOGLE_SHEETS_ID`
- `GOOGLE_PROJECT_ID`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`


