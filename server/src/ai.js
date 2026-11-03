// EXTRA CREDIT - AI CONFIGS: the "Sensei Assistant" chatbot.
//
// The model, provider, parameters and prompt all come from the LaunchDarkly AI
// Config `sensei-assistant`. Change the variation (or its targeting) in the
// dashboard and the very next chat message uses the new prompt/model - no deploy.
//
// Prompt templates can use these Mustache variables, filled in per member:
//   {{memberName}} {{role}} {{belt}} {{ageGroup}} {{childName}} {{dojoName}}
//   {{attendancePct}} {{upcomingSessions}}
//
// Every call is tracked (duration, tokens, success/error) and members can leave
// thumbs-up/down feedback, which shows up on the AI Config's Monitoring tab and
// can be used as an experiment metric.

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { LDFeedbackKind } from '@launchdarkly/server-sdk-ai';
import { config } from './config.js';
import { AI_CONFIG_KEY, buildContext, getAiClient } from './launchdarkly.js';

// Used when LaunchDarkly is unreachable or the AI Config doesn't exist yet.
// >>> The real prompts live in LaunchDarkly - see docs/launchdarkly-setup.md.
export const DEFAULT_AI_CONFIG = {
  enabled: true,
  provider: { name: 'anthropic' },
  model: { name: 'claude-haiku-5-5', parameters: { maxTokens: 400, temperature: 0.4 } },
  messages: [{
    role: 'system',
    content: 'You are Sensei Assistant for {{dojoName}}, a judo club. You are talking to {{memberName}} ({{role}}, {{belt}} belt, {{ageGroup}} class). '
      + 'Answer questions about judo technique, etiquette, belts and the club schedule in under 120 words. '
      + 'Their upcoming sessions:\n{{upcomingSessions}}\nAttendance this season: {{attendancePct}}.',
  }],
};

let anthropic;
let openai;

function pickProvider(name = '') {
  const n = name.toLowerCase();
  if (n.includes('anthropic') && config.anthropicApiKey) return 'anthropic';
  if (n.includes('openai') && config.openaiApiKey) return 'openai';
  return 'mock';
}

function cleanHistory(history) {
  const msgs = (Array.isArray(history) ? history : [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

async function callAnthropic(aiConfig, history) {
  anthropic ??= new Anthropic({ apiKey: config.anthropicApiKey });
  const p = aiConfig.model?.parameters ?? {};
  const system = (aiConfig.messages ?? []).filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const prompt = (aiConfig.messages ?? []).filter((m) => m.role !== 'system');
  const res = await anthropic.messages.create({
    model: aiConfig.model.name,
    max_tokens: Number(p.maxTokens ?? p.max_tokens ?? 400),
    ...(p.temperature !== undefined ? { temperature: Number(p.temperature) } : {}),
    system,
    messages: [...prompt, ...history],
  });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return { text, tokens: { input: res.usage.input_tokens, output: res.usage.output_tokens, total: res.usage.input_tokens + res.usage.output_tokens } };
}

async function callOpenAI(aiConfig, history) {
  openai ??= new OpenAI({ apiKey: config.openaiApiKey });
  const p = aiConfig.model?.parameters ?? {};
  const res = await openai.chat.completions.create({
    model: aiConfig.model.name,
    max_completion_tokens: Number(p.maxTokens ?? p.max_tokens ?? 400),
    ...(p.temperature !== undefined ? { temperature: Number(p.temperature) } : {}),
    messages: [...(aiConfig.messages ?? []), ...history],
  });
  const u = res.usage ?? {};
  return { text: res.choices[0]?.message?.content ?? '', tokens: { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, total: u.total_tokens ?? 0 } };
}

// Offline fallback so the demo works without an LLM API key. Clearly labelled.
function callMock(aiConfig, history, vars) {
  const q = (history.at(-1)?.content ?? '').toLowerCase();
  let text;
  if (/(next|when|schedule|class|session|training)/.test(q)) text = `Here's what's coming up for you:\n${vars.upcomingSessions}`;
  else if (/(tie|knot).*(belt|obi)|belt.*(tie|knot)/.test(q)) text = 'Find the middle of your belt, place it on your belly, wrap it twice around your waist, tuck the top end under both layers, then tie a square knot (right over left, left over right). Both ends should hang evenly.';
  else if (/(grading|grade|promotion|next belt)/.test(q)) text = `Gradings need roughly 75% attendance since your last grading. You're at ${vars.attendancePct}. Keep coming to class and ask your coach which techniques are on your ${vars.belt}-belt syllabus.`;
  else if (/(bow|rei|etiquette)/.test(q)) text = 'Bow (rei) when you enter and leave the dojo, when you step on and off the mat, and to your partner before and after practice. It shows respect for the place and the people who help you learn.';
  else text = `Osu, ${vars.memberName}! I can help with the class schedule, gradings, belt tying and dojo etiquette.`;
  const sys = aiConfig.messages?.find((m) => m.role === 'system')?.content ?? '';
  return { text: `${text}\n\n(Offline demo reply - add ${aiConfig.provider?.name === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} to .env for real ${aiConfig.model?.name ?? 'LLM'} answers. Active prompt starts: "${sys.slice(0, 80)}...")`, tokens: null };
}

/** Summary of the AI Config this member would get (used to show/hide the chat widget). */
export async function describeAiConfig(user, vars) {
  const aiConfig = await getAiClient().completionConfig(AI_CONFIG_KEY, buildContext(user), DEFAULT_AI_CONFIG, vars);
  return { enabled: aiConfig.enabled, model: aiConfig.model?.name, provider: aiConfig.provider?.name, mode: pickProvider(aiConfig.provider?.name) };
}

export async function chat(user, history, vars) {
  const context = buildContext(user);
  // 1. Ask LaunchDarkly which prompt + model this member should get.
  const aiConfig = await getAiClient().completionConfig(AI_CONFIG_KEY, context, DEFAULT_AI_CONFIG, vars);
  if (!aiConfig.enabled) return { disabled: true };

  // 2. Call the provider chosen by the AI Config, tracking metrics for this run.
  const tracker = aiConfig.createTracker();
  const mode = pickProvider(aiConfig.provider?.name);
  const msgs = cleanHistory(history);
  const started = Date.now();
  try {
    const result = mode === 'anthropic' ? await callAnthropic(aiConfig, msgs)
      : mode === 'openai' ? await callOpenAI(aiConfig, msgs)
        : callMock(aiConfig, msgs, vars);
    tracker.trackDuration(Date.now() - started);
    if (result.tokens) tracker.trackTokens(result.tokens);
    tracker.trackSuccess();
    const td = tracker.getTrackData();
    return {
      reply: result.text,
      model: aiConfig.model?.name,
      provider: aiConfig.provider?.name,
      variationKey: td.variationKey,
      mock: mode === 'mock',
      // Opaque token so feedback submitted later is attributed to this exact run.
      feedbackToken: tracker.resumptionToken,
    };
  } catch (err) {
    tracker.trackDuration(Date.now() - started);
    tracker.trackError();
    throw err;
  }
}

export function recordFeedback(user, token, positive) {
  const tracker = getAiClient().createTracker(token, buildContext(user));
  tracker.trackFeedback({ kind: positive ? LDFeedbackKind.Positive : LDFeedbackKind.Negative });
}
