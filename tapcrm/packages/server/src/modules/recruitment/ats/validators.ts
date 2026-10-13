import { z } from 'zod';
import { ATS_PROTECTED_CRITERION_MESSAGE, protectedCriterionTerm } from '@tapcrm/contracts';
import { MAX_CRITERIA_PER_LIST } from './criteria.js';

// Job-related wording only: the rule itself lives in contracts so the editor
// can explain a refusal before the request is sent.
const criterion = z.string().trim().min(1).max(120).refine(
  (value) => protectedCriterionTerm(value) === null,
  ATS_PROTECTED_CRITERION_MESSAGE,
);

const criteriaList = z.array(criterion).max(MAX_CRITERIA_PER_LIST).transform((values) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase('en');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});

export const atsCriteriaSchema = z.object({
  requiredSkills: criteriaList,
  preferredSkills: criteriaList,
  minimumExperienceYears: z.number().finite().min(0).max(50).nullable(),
  requiredQualifications: criteriaList,
}).strict().superRefine((criteria, context) => {
  if (criteria.requiredSkills.length === 0 && criteria.requiredQualifications.length === 0
      && (criteria.minimumExperienceYears === null || criteria.minimumExperienceYears === 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Configure at least one required skill, qualification, or positive minimum experience requirement before scanning.',
    });
  }
  const required = new Set(criteria.requiredSkills.map((value) => value.toLocaleLowerCase('en')));
  if (criteria.preferredSkills.some((value) => required.has(value.toLocaleLowerCase('en')))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['preferredSkills'], message: 'A skill cannot be both required and preferred.' });
  }
});

export const updateAtsCriteriaSchema = z.object({ criteria: atsCriteriaSchema }).strict();
export const runAtsScanSchema = z.object({}).strict();
