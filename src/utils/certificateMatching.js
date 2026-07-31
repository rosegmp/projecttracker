const LEGAL_SUFFIXES = new Set([
  'co',
  'company',
  'corp',
  'corporation',
  'inc',
  'incorporated',
  'limited',
  'llc',
  'ltd',
]);

export function normalizeSubcontractorName(value) {
  const tokens = String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\./g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(' ');
}

function levenshteinDistance(left, right) {
  if (!left) return right.length;
  if (!right) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

export function scoreSubcontractorName(extractedName, candidateName) {
  const extracted = normalizeSubcontractorName(extractedName);
  const candidate = normalizeSubcontractorName(candidateName);
  if (!extracted || !candidate) return 0;
  if (extracted === candidate) return 1;

  const extractedTokens = new Set(extracted.split(' '));
  const candidateTokens = new Set(candidate.split(' '));
  const sharedTokens = [...extractedTokens].filter((token) => candidateTokens.has(token)).length;
  const tokenSimilarity = sharedTokens / new Set([...extractedTokens, ...candidateTokens]).size;
  const editSimilarity = 1 - (levenshteinDistance(extracted, candidate) / Math.max(extracted.length, candidate.length));
  const containmentBonus = extracted.includes(candidate) || candidate.includes(extracted) ? 0.1 : 0;
  return Math.min(0.99, (tokenSimilarity * 0.6) + (editSimilarity * 0.4) + containmentBonus);
}

function aliasesForSubcontractor(subcontractor) {
  const contactName = `${subcontractor?.first || ''} ${subcontractor?.last || ''}`.trim();
  return [...new Set([subcontractor?.company, contactName].map((value) => String(value || '').trim()).filter(Boolean))];
}

export function findClosestSubcontractor(extractedName, subcontractors = []) {
  if (!normalizeSubcontractorName(extractedName) || !subcontractors.length) return null;

  const matches = subcontractors.flatMap((subcontractor) =>
    aliasesForSubcontractor(subcontractor).map((matchedName) => ({
      subcontractor,
      matchedName,
      score: scoreSubcontractorName(extractedName, matchedName),
    })));

  return matches.sort((left, right) =>
    right.score - left.score ||
    left.matchedName.localeCompare(right.matchedName) ||
    String(left.subcontractor?.id || '').localeCompare(String(right.subcontractor?.id || ''))
  )[0] || null;
}
