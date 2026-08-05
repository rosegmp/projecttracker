function positivePageNumber(value, fallback = 1) {
  const pageNumber = Number(value);
  return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : fallback;
}

function normalizedPageCount(snapshot) {
  const candidates = [
    positivePageNumber(snapshot?.pageCount, 0),
    positivePageNumber(snapshot?.pageNumber, 1),
    ...Object.keys(snapshot?.scales || {}).map((value) => positivePageNumber(value, 0)),
    ...(snapshot?.measurements || []).map((item) => positivePageNumber(item?.pageNumber, 0)),
    ...(snapshot?.markups || []).map((item) => positivePageNumber(item?.pageNumber, 0)),
  ];
  return Math.max(1, ...candidates);
}

export function splitTakeoffSnapshot(snapshot = {}) {
  const {
    scales = {},
    measurements = [],
    markups = [],
    ...metadata
  } = snapshot;
  const pageCount = normalizedPageCount(snapshot);

  return {
    snapshot: { ...metadata, pageCount },
    sheets: Array.from({ length: pageCount }, (_, index) => {
      const pageNumber = index + 1;
      return {
        page_number: pageNumber,
        name: `Sheet ${pageNumber}`,
        scale: scales[String(pageNumber)] || null,
      };
    }),
    measurements: (Array.isArray(measurements) ? measurements : []).map((measurement) => ({
      id: String(measurement?.id || ''),
      page_number: positivePageNumber(measurement?.pageNumber),
      type: String(measurement?.type || ''),
      label: String(measurement?.label || ''),
      color: String(measurement?.color || ''),
      symbol: String(measurement?.symbol || ''),
      points: Array.isArray(measurement?.points) ? measurement.points : [],
      source_created_at: measurement?.createdAt || null,
    })).filter((measurement) => measurement.id),
    markups: (Array.isArray(markups) ? markups : []).map((markup) => ({
      id: String(markup?.id || ''),
      page_number: positivePageNumber(markup?.pageNumber),
      type: String(markup?.type || ''),
      text: String(markup?.text || ''),
      color: String(markup?.color || ''),
      line_width: Math.min(24, Math.max(1, Number(markup?.thickness) || 3)),
      points: Array.isArray(markup?.points) ? markup.points : [],
      source_created_at: markup?.createdAt || null,
    })).filter((markup) => markup.id),
  };
}

export function hydrateNormalizedTakeoff(snapshot = {}, sheets = [], measurements = [], markups = []) {
  const scales = { ...(snapshot?.scales || {}) };
  sheets.forEach((sheet) => {
    if (sheet?.scale) scales[String(positivePageNumber(sheet.page_number))] = sheet.scale;
  });
  const measurementRows = measurements.length ? measurements : (snapshot?.measurements || []);
  const markupRows = markups.length ? markups : (snapshot?.markups || []);
  const normalizedMeasurements = measurements.length
    ? measurementRows.map((measurement) => ({
      id: String(measurement?.id || ''),
      pageNumber: positivePageNumber(measurement?.page_number),
      type: String(measurement?.type || ''),
      label: String(measurement?.label || ''),
      color: String(measurement?.color || ''),
      ...(measurement?.symbol ? { symbol: String(measurement.symbol) } : {}),
      points: Array.isArray(measurement?.points) ? measurement.points : [],
      ...(measurement?.source_created_at ? { createdAt: measurement.source_created_at } : {}),
    }))
    : measurementRows;
  const normalizedMarkups = markups.length
    ? markupRows.map((markup) => ({
      id: String(markup?.id || ''),
      pageNumber: positivePageNumber(markup?.page_number),
      type: String(markup?.type || ''),
      ...(markup?.text ? { text: String(markup.text) } : {}),
      color: String(markup?.color || ''),
      thickness: Math.min(24, Math.max(1, Number(markup?.line_width) || 3)),
      points: Array.isArray(markup?.points) ? markup.points : [],
      ...(markup?.source_created_at ? { createdAt: markup.source_created_at } : {}),
    }))
    : markupRows;

  return {
    ...snapshot,
    pageCount: Math.max(
      positivePageNumber(snapshot?.pageCount, 0),
      ...sheets.map((sheet) => positivePageNumber(sheet?.page_number, 0)),
      1,
    ),
    scales,
    measurements: normalizedMeasurements,
    markups: normalizedMarkups,
  };
}
