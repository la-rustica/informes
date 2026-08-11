// Función serverless de Vercel — /api/generate-informe
// Llama a Claude (Anthropic) para generar informes profesionales
// API key de Anthropic vive acá (variable de entorno en Vercel), nunca en el navegador.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en las variables de entorno de Vercel.' });
  }

  const { transcript, fecha, hora, geo, clinic, photos } = req.body || {};
  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ error: 'Falta la transcripción de la visita.' });
  }

  const geoLine = geo ? `Ubicación GPS: ${geo.lat}, ${geo.lon}` : 'Ubicación GPS: no disponible';

  const systemPrompt = `Sos un asistente que ayuda a un veterinario/responsable de campo de "La Rústica" en Paraguay a convertir una nota de voz informal en un informe profesional para enviar a su cliente.
Recibís la transcripción cruda de lo que dijo (puede tener errores de dictado, muletillas o desorden) y, opcionalmente, fotos tomadas durante la visita.
Devolvé SOLO un objeto JSON válido, sin texto adicional, sin backticks ni markdown, con esta forma exacta:
{"cliente": "nombre del cliente o establecimiento mencionado (si no está claro, poné 'Cliente sin identificar')", "motivo": "resumen de una línea del motivo de la visita", "informe": "informe completo, redactado en español formal pero claro, listo para enviar al cliente"}

El campo "informe" debe incluir, cuando la información esté disponible: fecha de la visita, animales o hacienda atendidos, hallazgos/diagnóstico, tratamiento realizado, indicaciones o recomendaciones, y próximos pasos o próxima visita sugerida. Redactalo en párrafos cortos y prolijos, en primera persona de quien visitó el campo, sin inventar datos que no estén en la nota ni en las fotos.`;

  const userContent = [
    { type: 'text', text:
      `Fecha de la visita: ${fecha}\nHora: ${hora}\n${geoLine}\n${clinic ? 'Responsable: ' + clinic : ''}\n\nTranscripción de la nota de voz:\n"""${transcript}"""` }
  ];

  (photos || []).slice(0, 4).forEach(dataUrl => {
    const match = typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/[a-zA-Z]+);base64,(.*)$/);
    if (match) {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
    }
  });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: `Claude API respondió ${resp.status}: ${errText.slice(0, 300)}` });
    }

    const data = await resp.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) return res.status(502).json({ error: 'La respuesta no tuvo contenido de texto.' });

    const clean = textBlock.text.trim().replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Error inesperado generando el informe.' });
  }
}
