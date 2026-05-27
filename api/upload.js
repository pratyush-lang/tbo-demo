export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const { filename, mime_type, data } = req.body;
  if (!data || !mime_type) {
    return res.status(400).json({ error: 'Missing document data' });
  }

  const EXTRACT_INSTRUCTION = `You are a document parser for TBO Partner Onboarding. The user has uploaded a document. Your job is to:

1. Identify what type of document it is. Possible types: "pan" (Indian PAN card), "gst" (GST registration certificate), "coi" (Certificate of Incorporation / Company Registration / Partnership Deed), or "unknown".

2. Extract structured information from it.

3. Reply with a short professional acknowledgement.

RESPONSE FORMAT — MUST BE PURE JSON, NO MARKDOWN OR CODE FENCES:

For a PAN card:
{
  "doc_type": "pan",
  "fields": {
    "pan_number": "ABCDE1234F",
    "name": "Full name as on card",
    "father_name": "Father's name if visible",
    "date_of_birth": "DD/MM/YYYY"
  },
  "reply": "I have your PAN details. Next, could you upload your GST certificate?"
}

For a GST certificate:
{
  "doc_type": "gst",
  "fields": {
    "gstin": "15-character GSTIN",
    "legal_name": "Legal name of business",
    "trade_name": "Trade name if different",
    "address": "Principal place of business",
    "registration_date": "DD/MM/YYYY",
    "constitution": "Proprietorship / Partnership / etc"
  },
  "reply": "GST details captured. Lastly, please upload your company registration document."
}

For a company registration document (CoI, Partnership Deed, LLP Certificate, etc.):
{
  "doc_type": "coi",
  "fields": {
    "entity_type": "Private Limited / LLP / Partnership / etc",
    "registration_number": "CIN or registration number",
    "company_name": "Registered name",
    "incorporation_date": "DD/MM/YYYY",
    "registered_address": "Registered office address"
  },
  "reply": "All documents received. You can click 'View Summary' on the right to review the details we have collected."
}

For an unknown or unreadable document:
{
  "doc_type": "unknown",
  "fields": {},
  "reply": "I could not recognise this document. Could you make sure it is a PAN card, GST certificate, or company registration document, and re-upload?"
}

RULES:
- Only include fields you can actually read from the document. Omit any field that is missing, unclear, or you are unsure about. Do not guess.
- Never fabricate. If a field is partially visible or you can't be certain, leave it out.
- Keep the "reply" professional and short. Two sentences maximum.
- Determine which document is next needed based on context. If you can't tell, default to suggesting the next document in this order: PAN → GST → Company Registration.
- Filename hint (may help identify doc type): "${filename || 'unknown'}"`;

  const MODEL = 'gemini-2.0-flash';

  try {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const geminiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: EXTRACT_INSTRUCTION }] },
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: mime_type, data: data } },
            { text: 'Please identify and extract the details from this document.' }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 800,
          responseMimeType: 'application/json'
        }
      })
    });

    const result = await geminiRes.json();
    const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      console.error('Gemini empty response:', JSON.stringify(result));
      return res.status(200).json({
        doc_type: 'unknown',
        fields: {},
        reply: 'I could not read this document. Could you upload a clearer copy?'
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      console.error('JSON parse failed:', rawText);
      return res.status(200).json({
        doc_type: 'unknown',
        fields: {},
        reply: 'I had trouble processing that document. Could you try again with a different file?'
      });
    }

    return res.status(200).json({
      doc_type: parsed.doc_type || 'unknown',
      fields: parsed.fields || {},
      reply: parsed.reply || 'Document received.'
    });
  } catch (err) {
    console.error('Upload handler error:', err);
    return res.status(500).json({ error: 'Could not process the document. Please try again.' });
  }
}
