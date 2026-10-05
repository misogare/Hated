import { describe, expect, it } from 'vitest';

import {
  SEED_INSTITUTIONS,
  SEED_QUESTIONNAIRE,
  SEED_QUESTIONS,
} from '../src/seed-data.js';

describe('SEED_INSTITUTIONS', () => {
  it('is non-empty and uses unique domains', () => {
    expect(SEED_INSTITUTIONS.length).toBeGreaterThan(0);
    const domains = SEED_INSTITUTIONS.map((institution) => institution.domain);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it('covers both EDU and GOV institutions', () => {
    const types = new Set(SEED_INSTITUTIONS.map((institution) => institution.type));
    expect(types.has('EDU')).toBe(true);
    expect(types.has('GOV')).toBe(true);
  });

  it('has a lowercase domain matching the institution type, and a name', () => {
    // Academic domains are regional (`.edu`, `.edu.au`, `.ac.uk`, ...), so check
    // for an academic or government label rather than one exact suffix.
    const academic = /(^|\.)(edu|ac)(\.|$)/;
    const government = /(^|\.)gov(\.|$)/;

    for (const institution of SEED_INSTITUTIONS) {
      expect(institution.domain).toBe(institution.domain.toLowerCase());
      const pattern = institution.type === 'EDU' ? academic : government;
      expect(pattern.test(institution.domain)).toBe(true);
      expect(institution.name.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('SEED_QUESTIONNAIRE', () => {
  it('has a non-empty key and a positive version', () => {
    expect(SEED_QUESTIONNAIRE.key.length).toBeGreaterThan(0);
    expect(SEED_QUESTIONNAIRE.version).toBeGreaterThanOrEqual(1);
  });
});

describe('SEED_QUESTIONS', () => {
  it('has unique question keys', () => {
    const keys = SEED_QUESTIONS.map((question) => question.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('scores each trait at most once', () => {
    const traitKeys = SEED_QUESTIONS.map((question) => question.traitKey).filter(
      (key): key is string => key !== undefined,
    );
    expect(traitKeys.length).toBeGreaterThan(0);
    expect(new Set(traitKeys).size).toBe(traitKeys.length);
  });

  it('ties every SCALE question to a trait and gives it a numeric range', () => {
    const scales = SEED_QUESTIONS.filter((question) => question.kind === 'SCALE');
    expect(scales.length).toBeGreaterThan(0);

    for (const question of scales) {
      expect(question.traitKey).toBeDefined();
      const options = question.options as { min?: unknown; max?: unknown } | undefined;
      expect(typeof options?.min).toBe('number');
      expect(typeof options?.max).toBe('number');
    }
  });

  it('gives every question a prompt', () => {
    for (const question of SEED_QUESTIONS) {
      expect(question.prompt.trim().length).toBeGreaterThan(0);
    }
  });
});
