/**
 * Keyword-based intent router.
 * Matches user messages against registered workflow pack triggers
 * and returns an IntentResolution with confidence level.
 */

import { getCapability } from './capabilities.js';
import { getAllPacks } from './registry.js';
import type { DesignWorkflowContext, IntentResolution, WorkflowCapability } from './types.js';

/**
 * Match a message against keywords, returning score, count, and matched tokens.
 * Full phrase match = 2 points, individual word match (>6 chars) = 1 point.
 */
function matchKeywords(message: string, keywords: string[]): { score: number; count: number; tokens: string[] } {
  const lower = message.toLowerCase();
  let score = 0;
  let count = 0;
  const tokens: string[] = [];

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (lower.includes(kwLower)) {
      score += 2;
      count++;
      tokens.push(kwLower);
      continue;
    }
    const words = kwLower.split(/\s+/).filter((w) => w.length > 6);
    if (words.some((word) => lower.includes(word))) {
      score += 1;
      count++;
      tokens.push(kwLower);
    }
  }

  return { score, count, tokens: [...new Set(tokens)] };
}

// Design context words — message must contain at least one to be routable
const DESIGN_CONTEXT_WORDS = [
  'screen',
  'page',
  'layout',
  'header',
  'footer',
  'section',
  'component',
  'button',
  'card',
  'hero',
  'nav',
  'sidebar',
  'modal',
  'form',
  'input',
  'icon',
  'frame',
  'design',
  'figma',
  'schermata',
  'pagina',
  'sezione',
  'componente',
  'token',
  'variable',
  'color',
  'spacing',
  'typography',
  'font',
  'ds',
  'design system',
  'libreria',
  'library',
];

// Generic verbs that need design context to be meaningful
const GENERIC_ONLY_TRIGGERS = ['change', 'update', 'modify', 'fix', 'cambia', 'modifica'];

function hasDesignContext(message: string): boolean {
  const lower = message.toLowerCase();
  return DESIGN_CONTEXT_WORDS.some((w) => lower.includes(w));
}

function isGenericOnly(tokens: string[]): boolean {
  return tokens.length > 0 && tokens.every((t) => GENERIC_ONLY_TRIGGERS.includes(t));
}

/**
 * Resolve intent from user message against all registered packs.
 *
 * Confidence:
 * - high:   2+ trigger keywords match
 * - medium: 1 keyword matches
 * - low:    partial match (substring of keyword)
 * - none:   no match → pack: null
 */
export function resolveIntent(userMessage: string, context: DesignWorkflowContext): IntentResolution {
  if (!userMessage || userMessage.trim() === '') {
    return { pack: null, confidence: 'none', context, capabilities: [] };
  }

  const packs = getAllPacks();

  let bestPack = null;
  let bestScore = 0;
  let bestMatchCount = 0;
  let bestTokens: string[] = [];

  for (const pack of packs) {
    for (const trigger of pack.triggers) {
      const { score: rawScore, count, tokens } = matchKeywords(userMessage, trigger.keywords);
      const weightedScore = rawScore * trigger.confidence;
      if (weightedScore > bestScore) {
        bestScore = weightedScore;
        bestMatchCount = count;
        bestTokens = tokens;
        bestPack = pack;
      }
    }
  }

  if (bestPack === null || bestScore === 0) {
    return { pack: null, confidence: 'none', context, capabilities: [] };
  }

  let confidence: IntentResolution['confidence'];
  if (bestMatchCount >= 2) {
    confidence = 'high';
  } else {
    confidence = 'medium';
  }

  // If only generic verbs matched and there's no design context in the message, don't route —
  // prevents "update me on the status" from triggering update-screen.
  if (isGenericOnly(bestTokens) && !hasDesignContext(userMessage)) {
    return { pack: null, confidence: 'none', context, capabilities: [] };
  }

  const capabilities: WorkflowCapability[] = bestPack.capabilities.map((id) => getCapability(id));

  // Ensure the resolved mode is one this pack supports.
  // If the current mode isn't in supportedModes, fall back to the first supported mode
  // so the extension factory always receives a compatible context (never a mode the pack
  // has no instructions for).
  const fallbackMode = bestPack.supportedModes[0] ?? context.interactionMode;
  const effectiveContext = bestPack.supportedModes.includes(context.interactionMode)
    ? context
    : { ...context, interactionMode: fallbackMode };

  return { pack: bestPack, confidence, context: effectiveContext, capabilities };
}
