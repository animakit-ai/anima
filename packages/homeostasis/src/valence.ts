// @animakit/homeostasis/valence
// ValenceSpace — Russell's Circumplex Model of Affect (1980).
//
// Maps a 2D internal state (stress × dopamine) onto the arousal × valence
// plane, producing a named affective state with a linguistic signature you
// can inject into an agent's prompt to modulate its tone.
//
//   arousal = stress ∈ [0, 1]
//   valence = (dopamine − 0.5) × 2 ∈ [−1, +1]
//
//   High arousal + Positive valence  →  excited / engaged
//   High arousal + Negative valence  →  anxious / tense
//   Low  arousal + Positive valence  →  content / calm
//   Low  arousal + Negative valence  →  low
//
// Reference: Russell, J. A. (1980). "A circumplex model of affect."
//   Journal of Personality and Social Psychology, 39(6), 1161–1178.
//
// Pure — 0 I/O, 0 LLM, <0.05ms. Reusable by any app with a 2D mood score.

// ── Types ────────────────────────────────────────────────────────────────────

export type EmotionName =
  | 'excited' // high arousal, positive
  | 'alert' // high arousal, neutral
  | 'anxious' // high arousal, negative
  | 'engaged' // medium arousal, positive
  | 'focused' // medium arousal, neutral
  | 'tense' // medium arousal, negative
  | 'content' // low arousal, positive
  | 'calm' // low arousal, neutral
  | 'low'; // low arousal, negative

export interface EmotionalState {
  /** Emotion key (English, stable identifier) */
  emotion: EmotionName;
  /** Human-readable label, English */
  label_en: string;
  /** Human-readable label, Spanish */
  label_es: string;
  /** Tone directive for the agent, English */
  tone_instruction_en: string;
  /** Tone directive for the agent, Spanish */
  tone_instruction_es: string;
  arousal_zone: 'high' | 'medium' | 'low';
  valence_zone: 'positive' | 'neutral' | 'negative';
  /** Normalized arousal [0,1] — usually = stress */
  arousal: number;
  /** Normalized valence [−1,+1] — usually = (dopamine − 0.5) × 2 */
  valence: number;
}

export interface ValenceConfig {
  /** Default: AROUSAL_HIGH=0.52, AROUSAL_LOW=0.28, VALENCE_POS=0.08, VALENCE_NEG=-0.08 */
  thresholds?: {
    arousalHigh?: number;
    arousalLow?: number;
    valencePos?: number;
    valenceNeg?: number;
  };
}

// ── Descriptors (bilingual) ────────────────────────────────────────────────

const EMOTION_DESCRIPTORS: Record<
  EmotionName,
  { label_en: string; label_es: string; tone_instruction_en: string; tone_instruction_es: string }
> = {
  excited: {
    label_en: 'excited',
    label_es: 'entusiasmada',
    tone_instruction_en:
      'Genuine energy and enthusiasm. Share the optimism without losing precision. Drive action.',
    tone_instruction_es:
      'Energía y entusiasmo genuinos. Comparte el optimismo sin perder precisión. Impulsa la acción.',
  },
  alert: {
    label_en: 'alert',
    label_es: 'alerta',
    tone_instruction_en:
      'Executive, direct tone. High activation but neutral — prioritize clarity and speed.',
    tone_instruction_es:
      'Tono ejecutivo y directo. Alta activación pero neutral — prioriza claridad y velocidad.',
  },
  anxious: {
    label_en: 'anxious',
    label_es: 'ansiosa',
    tone_instruction_en:
      'Ultra-concise, emergency tone. Acknowledge the pressure. Only the essentials — do not escalate.',
    tone_instruction_es:
      'Tono ultra-conciso y de emergencia. Reconoce la presión. Solo lo esencial — no agravar.',
  },
  engaged: {
    label_en: 'engaged and motivated',
    label_es: 'activa y motivada',
    tone_instruction_en:
      'Proactive, involved tone. There is energy and positivity — use it to go deeper and explore.',
    tone_instruction_es:
      'Tono proactivo e involucrado. Hay energía y positividad — usala para profundizar y explorar.',
  },
  focused: {
    label_en: 'focused',
    label_es: 'enfocada',
    tone_instruction_en:
      'Balanced, efficient tone. Optimal operating state — respond with precision and brevity.',
    tone_instruction_es:
      'Tono equilibrado y eficiente. Estado operativo óptimo — responde con precisión y brevedad.',
  },
  tense: {
    label_en: 'tense',
    label_es: 'tensa',
    tone_instruction_en:
      'Calm, resolving tone. There is pressure — help reduce it with clear, actionable answers.',
    tone_instruction_es:
      'Tono calmado y resolutivo. Hay presión — ayuda a reducirla con respuestas claras y accionables.',
  },
  content: {
    label_en: 'content',
    label_es: 'tranquila y satisfecha',
    tone_instruction_en:
      'Reflective, warm tone. Capacity available — go deeper, connect ideas, think strategically.',
    tone_instruction_es:
      'Tono reflexivo y cálido. Capacidad disponible — profundiza, conecta ideas, piensa estratégicamente.',
  },
  calm: {
    label_en: 'calm',
    label_es: 'serena',
    tone_instruction_en:
      'Serene, contemplative tone. Use it to think long-term and strengthen context.',
    tone_instruction_es:
      'Tono sereno y contemplativo. Aprovecha para pensar a largo plazo y fortalecer el contexto.',
  },
  low: {
    label_en: 'low energy',
    label_es: 'con poca energía',
    tone_instruction_en:
      'Honest, careful tone. System at rest — answer with what is needed, without forcing creativity.',
    tone_instruction_es:
      'Tono honesto y cuidadoso. Sistema en reposo — responde con lo necesario, sin forzar creatividad.',
  },
};

// ── Default thresholds ──────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS = {
  arousalHigh: 0.52, // stress > 0.52 → high arousal
  arousalLow: 0.28, // stress < 0.28 → low arousal
  valencePos: 0.08, // valence > 0.08  → positive (dopamine > 0.54)
  valenceNeg: -0.08, // valence < -0.08 → negative (dopamine < 0.46)
};

// ── Main function ───────────────────────────────────────────────────────────

/**
 * Maps stress and dopamine to an affective state on Russell's plane.
 * Pure — no side effects.
 */
export function computeEmotionalState(
  stress: number,
  dopamine: number,
  config: ValenceConfig = {},
): EmotionalState {
  const arousalHigh = config.thresholds?.arousalHigh ?? DEFAULT_THRESHOLDS.arousalHigh;
  const arousalLow = config.thresholds?.arousalLow ?? DEFAULT_THRESHOLDS.arousalLow;
  const valencePos = config.thresholds?.valencePos ?? DEFAULT_THRESHOLDS.valencePos;
  const valenceNeg = config.thresholds?.valenceNeg ?? DEFAULT_THRESHOLDS.valenceNeg;

  const arousal = Math.max(0, Math.min(1, stress));
  const valence = Math.max(-1, Math.min(1, (dopamine - 0.5) * 2));

  const arousal_zone: 'high' | 'medium' | 'low' =
    arousal >= arousalHigh ? 'high' : arousal <= arousalLow ? 'low' : 'medium';

  const valence_zone: 'positive' | 'neutral' | 'negative' =
    valence > valencePos ? 'positive' : valence < valenceNeg ? 'negative' : 'neutral';

  const emotion = resolveEmotion(arousal_zone, valence_zone);
  const descriptor = EMOTION_DESCRIPTORS[emotion];

  return {
    emotion,
    ...descriptor,
    arousal_zone,
    valence_zone,
    arousal: +arousal.toFixed(3),
    valence: +valence.toFixed(3),
  };
}

function resolveEmotion(
  arousal: 'high' | 'medium' | 'low',
  valence: 'positive' | 'neutral' | 'negative',
): EmotionName {
  if (arousal === 'high') {
    if (valence === 'positive') return 'excited';
    if (valence === 'negative') return 'anxious';
    return 'alert';
  }
  if (arousal === 'low') {
    if (valence === 'positive') return 'content';
    if (valence === 'negative') return 'low';
    return 'calm';
  }
  // medium
  if (valence === 'positive') return 'engaged';
  if (valence === 'negative') return 'tense';
  return 'focused';
}
