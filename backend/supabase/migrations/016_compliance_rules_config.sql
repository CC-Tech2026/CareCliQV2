-- 016_compliance_rules_config.sql
-- Adds config (JSONB), category, and guidance_text columns to compliance_rules.
-- Seeds each R1–R12 row with its patterns, thresholds, and guidance so the
-- engine reads everything from the DB instead of hardcoded module constants.
--
-- config JSONB schema per rule:
--   R1:  { max_duration_minutes }
--   R2:  { warn_after_days, fail_after_days }
--   R3:  { min_words_pass, min_words_warn, filler_phrases: [{pattern, label}] }
--   R5:  { goal_language_patterns: [string] }
--   R6:  { subjective_phrases: [{pattern, label}] }
--   R7:  { violations: [{pattern, suggestion}] }
--   R8:  { violation_patterns: [{pattern, label}] }
--   R9:  { trigger_patterns: [{pattern, label}] }
--   R11: { fail_threshold, warn_threshold, lookback_count }
--   R12: { response_patterns: [string] }
--   R4, R10: config is null (logic has no configurable parameters)

ALTER TABLE public.compliance_rules
  ADD COLUMN IF NOT EXISTS config       jsonb NULL,
  ADD COLUMN IF NOT EXISTS category     text  NULL,
  ADD COLUMN IF NOT EXISTS guidance_text text  NULL;

-- ---------------------------------------------------------------------------
-- R1 — Session time and duration
-- ---------------------------------------------------------------------------
UPDATE public.compliance_rules SET
  category      = 'documentation',
  guidance_text = 'Record the session date, start time, end time, and total duration for every support delivery. Without these fields the session cannot be claimed or audited.',
  config        = '{"max_duration_minutes": 480}'::jsonb
WHERE rule_code = 'R1';

-- ---------------------------------------------------------------------------
-- R2 — 48-hour documentation
-- ---------------------------------------------------------------------------
UPDATE public.compliance_rules SET
  category      = 'documentation',
  guidance_text = 'Submit your progress note within 48 hours of the session. If submitting late, acknowledge the delay and document the reason.',
  config        = '{"warn_after_days": 2, "fail_after_days": 7}'::jsonb
WHERE rule_code = 'R2';

-- ---------------------------------------------------------------------------
-- R3 — Note quality
-- ---------------------------------------------------------------------------
UPDATE public.compliance_rules SET
  category      = 'documentation',
  guidance_text = 'Write at least 80 words of specific, observable clinical detail. Avoid vague phrases like "good session" or "did shopping" — describe exactly what was done and how.',
  config        = $cfg${
    "min_words_pass": 80,
    "min_words_warn": 30,
    "filler_phrases": [
      {"pattern": "\\bgood session\\b",                         "label": "good session"},
      {"pattern": "\\bdid\\s+shopping\\b",                     "label": "did shopping"},
      {"pattern": "\\ball\\s+went\\s+well\\b",                 "label": "all went well"},
      {"pattern": "\\bwent\\s+well\\b",                        "label": "went well"},
      {"pattern": "\\bnothing\\s+to\\s+report\\b",             "label": "nothing to report"},
      {"pattern": "\\bno\\s+issues\\b",                        "label": "no issues"},
      {"pattern": "\\bsame\\s+as\\s+usual\\b",                 "label": "same as usual"},
      {"pattern": "\\bas\\s+per\\s+usual\\b",                  "label": "as per usual"},
      {"pattern": "\\bas\\s+usual\\b",                         "label": "as usual"},
      {"pattern": "\\bcompleted\\s+tasks\\b",                  "label": "completed tasks"},
      {"pattern": "\\bdone\\s+for\\s+the\\s+day\\b",           "label": "done for the day"},
      {"pattern": "\\bno\\s+concerns\\b",                      "label": "no concerns"},
      {"pattern": "\\bstandard\\s+session\\b",                 "label": "standard session"},
      {"pattern": "\\bregular\\s+session\\b",                  "label": "regular session"},
      {"pattern": "\\bthe\\s+usual\\b",                        "label": "the usual"},
      {"pattern": "\\buneventful\\b",                          "label": "uneventful"},
      {"pattern": "\\bsame\\s+as\\s+last\\s+(?:time|session|week)\\b", "label": "same as last time"}
    ]
  }$cfg$::jsonb
WHERE rule_code = 'R3';

-- ---------------------------------------------------------------------------
-- R4 — Support type documented  (no configurable patterns)
-- ---------------------------------------------------------------------------
UPDATE public.compliance_rules SET
  category      = 'documentation',
  guidance_text = 'Select the NDIS support type (registration group) that matches the service delivered. Required for claim traceability.',
  config        = NULL
WHERE rule_code = 'R4';

-- ---------------------------------------------------------------------------
-- R5 — Goals referenced in note
-- ---------------------------------------------------------------------------
UPDATE public.compliance_rules SET
  category      = 'language',
  guidance_text = 'Reference at least one active NDIS goal by name, number, or approved goal language. Describe the participant''s progress toward that goal.',
  config        = $cfg${
    "goal_language_patterns": [
      "\\bgoal\\b",
      "\\bobjective\\b",
      "\\baim(?:ed|s)?\\b",
      "\\btarget\\b",
      "\\bmilestone\\b",
      "\\bworked\\s+(?:on|toward)\\b",
      "\\bprogress\\b",
      "\\bachiev\\w+\\b",
      "\\bindependen\\w+\\b",
      "\\bskill\\b",
      "\\bdevelop\\w+\\b",
      "\\bimprove\\w+\\b",
      "\\bndis\\s+plan\\b",
      "\\bplan\\s+goal\\b",
      "\\bfocus\\s+area\\b"
    ]
  }$cfg$::jsonb
WHERE rule_code = 'R5';

-- ---------------------------------------------------------------------------
-- R6 — Objective language
-- ---------------------------------------------------------------------------
UPDATE public.compliance_rules SET
  category      = 'language',
  guidance_text = 'Use objective, observable language only. Replace opinions ("I think", "I believe") with documented facts and direct participant statements.',
  config        = $cfg${
    "subjective_phrases": [
      {"pattern": "\\bI\\s+think\\b",                                   "label": "I think"},
      {"pattern": "\\bI\\s+believe\\b",                                 "label": "I believe"},
      {"pattern": "\\bI\\s+feel\\b",                                    "label": "I feel"},
      {"pattern": "\\bI\\s+suspect\\b",                                 "label": "I suspect"},
      {"pattern": "\\bI\\s+reckon\\b",                                  "label": "I reckon"},
      {"pattern": "\\bI\\s+guess\\b",                                   "label": "I guess"},
      {"pattern": "\\bseems\\s+like\\b",                                "label": "seems like"},
      {"pattern": "\\bseems\\s+to\\s+be\\b",                           "label": "seems to be"},
      {"pattern": "\\bprobably\\s+(?:has|have|is|are|was|were)\\b",    "label": "probably has/is"},
      {"pattern": "\\bmight\\s+be\\s+(?:due|caused|because)\\b",       "label": "might be due"}
    ]
  }$cfg$::jsonb
WHERE rule_code = 'R6';

-- ---------------------------------------------------------------------------
-- R7 — Person-first language
-- ---------------------------------------------------------------------------
UPDATE public.compliance_rules SET
  category      = 'language',
  guidance_text = 'Use person-first language throughout. Write "person who uses a wheelchair" not "wheelchair-bound". The person always comes before their disability.',
  config        = $cfg${
    "violations": [
      {"pattern": "\\bautistic\\s+(?:person|child|adult|individual|client|man|woman|boy|girl)\\b", "suggestion": "person with autism"},
      {"pattern": "\\bwheelchair[- ]?bound\\b",                                                    "suggestion": "person who uses a wheelchair"},
      {"pattern": "\\bconfined\\s+to\\s+(?:a\\s+)?wheelchair\\b",                                 "suggestion": "person who uses a wheelchair"},
      {"pattern": "\\bsuffers?\\s+from\\b",                                                        "suggestion": "has a diagnosis of"},
      {"pattern": "\\bthe\\s+disabled\\b",                                                         "suggestion": "person with disability"},
      {"pattern": "\\bspecial\\s+needs\\b",                                                        "suggestion": "support needs"},
      {"pattern": "\\bmental(?:ly)?\\s+retard\\w*\\b",                                            "suggestion": "person with intellectual disability"},
      {"pattern": "\\bblind\\s+(?:person|people|client)\\b",                                      "suggestion": "person who is blind"},
      {"pattern": "\\bdeaf\\s+(?:person|people|client)\\b",                                       "suggestion": "person who is deaf"},
      {"pattern": "\\bepilept(?:ic|ics)\\b",                                                      "suggestion": "person with epilepsy"}
    ]
  }$cfg$::jsonb
WHERE rule_code = 'R7';

-- ---------------------------------------------------------------------------
-- R8 — Scope of practice
-- ---------------------------------------------------------------------------
UPDATE public.compliance_rules SET
  category      = 'language',
  guidance_text = 'Support workers must not document clinical assessments, diagnoses, or medication administration. If clinical actions occurred, document the referral to the appropriate clinician.',
  config        = $cfg${
    "violation_patterns": [
      {"pattern": "\\bdiagnos(?:ed|es|ing|is)\\b",                                                        "label": "clinical diagnosis"},
      {"pattern": "\\bdiagnosis\\s+of\\b",                                                                "label": "clinical diagnosis"},
      {"pattern": "\\badminister(?:ed|ing)?\\s+(?:medication|meds|drug|tablet|dose|injection)\\b",        "label": "medication administration"},
      {"pattern": "\\bgave\\s+(?:the\\s+)?(?:medication|meds|tablet|pill|injection|dose)\\b",             "label": "medication administration"},
      {"pattern": "\\binjected\\b",                                                                        "label": "injection administration"},
      {"pattern": "\\bgave\\s+(?:a\\s+)?PRN\\b",                                                          "label": "PRN medication administration"},
      {"pattern": "\\bclinical\\s+assessment\\b",                                                          "label": "clinical assessment"},
      {"pattern": "\\bmental\\s+health\\s+assessment\\b",                                                  "label": "mental health assessment"},
      {"pattern": "\\bpsychiatric\\s+(?:assessment|evaluation|review)\\b",                                 "label": "psychiatric assessment"},
      {"pattern": "\\bmedical\\s+(?:assessment|evaluation|examination)\\b",                                "label": "medical assessment"},
      {"pattern": "\\bwound\\s+(?:care|dressing|management)\\b",                                          "label": "wound care"},
      {"pattern": "\\bprescrib(?:ed|es|ing)\\b",                                                          "label": "prescribing medication"},
      {"pattern": "\\bnursing\\s+assessment\\b",                                                          "label": "nursing assessment"}
    ]
  }$cfg$::jsonb
WHERE rule_code = 'R8';

-- ---------------------------------------------------------------------------
-- R9 — Incident triggers
-- ---------------------------------------------------------------------------
UPDATE public.compliance_rules SET
  category      = 'safety',
  guidance_text = 'If an incident occurred, complete the auto-created incident draft immediately. NDIS serious incidents must be reported to the Commission within 24 hours.',
  config        = $cfg${
    "trigger_patterns": [
      {"pattern": "\\bfell\\b|\\bfall(?:ing)?\\b|\\btripped\\b",                                                                                      "label": "fall/injury"},
      {"pattern": "\\baggressive\\b|\\baggression\\b|\\bviolent\\b|\\battack(?:ed|ing)?\\b|\\bhit\\s+(?:a\\s+)?(?:staff|worker|carer|support)\\b",    "label": "aggression/violence"},
      {"pattern": "\\bhospital(?:ised|ized)?\\b|\\bemergency\\s+department\\b|\\bED\\b(?!\\w)",                                                        "label": "hospital/ED"},
      {"pattern": "\\bambulance\\b|\\b000\\b|\\bparamedic\\b",                                                                                         "label": "ambulance/emergency services"},
      {"pattern": "\\bself[-\\s]harm\\b|\\bself[-\\s]injur\\w+\\b|\\bsuicid\\w+\\b",                                                                  "label": "self-harm/suicidality"},
      {"pattern": "\\babuse\\b|\\bneglect\\b|\\bmistreat\\w+\\b|\\bexploit\\w+\\b",                                                                   "label": "abuse/neglect"},
      {"pattern": "\\boverdose\\b",                                                                                                                     "label": "overdose"},
      {"pattern": "\\bseizure\\b|\\bconvuls\\w+\\b|\\bepileptic\\s+episode\\b",                                                                       "label": "seizure/medical emergency"},
      {"pattern": "\\bunconscious\\b|\\bpassed\\s+out\\b|\\bfainted\\b|\\bunresponsive\\b",                                                           "label": "loss of consciousness"},
      {"pattern": "\\bdeceased\\b|\\bpassed\\s+away\\b",                                                                                              "label": "death"}
    ]
  }$cfg$::jsonb
WHERE rule_code = 'R9';

-- ---------------------------------------------------------------------------
-- R10 — Restrictive practice reported
-- config.categories: {category: {severity, patterns[]}}
-- ---------------------------------------------------------------------------
UPDATE public.compliance_rules SET
  category      = 'safety',
  guidance_text = 'Restrictive practices must be linked to an approved behaviour support plan and a submitted incident report. The note cannot be approved until both are complete.',
  config        = $cfg${
    "categories": {
      "chemical_restraint": {
        "severity": "critical",
        "patterns": [
          "given\\s+sedative", "administered\\s+sedative", "chemical\\s+calm",
          "chemical\\s+restraint", "sedated\\s+to\\s+calm", "medication\\s+to\\s+restrain",
          "PRN\\s+for\\s+behaviour", "calming\\s+medication", "chemical\\s+control",
          "medicated\\s+for\\s+behaviour"
        ]
      },
      "physical_restraint": {
        "severity": "critical",
        "patterns": [
          "held\\s+down", "physically\\s+restrained", "physical\\s+restraint",
          "pinned\\s+down", "grabbed\\s+and\\s+held", "forced\\s+to\\s+stay",
          "arm\\s+held", "restrained\\s+by\\s+staff", "manual\\s+restraint",
          "staff\\s+held", "body\\s+hold", "crisis\\s+hold", "prone\\s+restraint"
        ]
      },
      "mechanical_restraint": {
        "severity": "high",
        "patterns": [
          "tied\\s+to\\s+chair", "strapped\\s+to", "mechanical\\s+restraint",
          "wrist\\s+restraint", "lap\\s+belt", "safety\\s+strap", "restrained\\s+with",
          "wheelchair\\s+strap", "body\\s+suit", "restraint\\s+device"
        ]
      },
      "environmental_restraint": {
        "severity": "high",
        "patterns": [
          "locked\\s+in\\s+room", "environmental\\s+restraint", "confined\\s+to",
          "restricted\\s+to\\s+room", "door\\s+locked", "prevented\\s+from\\s+leaving",
          "access\\s+denied", "not\\s+allowed\\s+to\\s+leave", "restricted\\s+access",
          "room\\s+locked"
        ]
      },
      "seclusion": {
        "severity": "high",
        "patterns": [
          "placed\\s+in\\s+seclusion", "seclusion\\s+room", "isolated\\s+in",
          "secluded", "time[\\s-]out\\s+room", "placed\\s+alone\\s+in",
          "removed\\s+and\\s+isolated", "solitary", "seclusion\\s+used"
        ]
      }
    }
  }$cfg$::jsonb
WHERE rule_code = 'R10';

-- ---------------------------------------------------------------------------
-- R11 — Note uniqueness
-- ---------------------------------------------------------------------------
UPDATE public.compliance_rules SET
  category      = 'safety',
  guidance_text = 'Ensure each note is specific to this session. NDIS auditors flag copy-pasted or templated notes as evidence that genuine support was not delivered.',
  config        = '{"fail_threshold": 0.75, "warn_threshold": 0.55, "lookback_count": 5}'::jsonb
WHERE rule_code = 'R11';

-- ---------------------------------------------------------------------------
-- R12 — Participant response
-- ---------------------------------------------------------------------------
UPDATE public.compliance_rules SET
  category      = 'safety',
  guidance_text = 'Document how the participant responded using observable language: "participant reported", "participant demonstrated", "participant engaged", "participant declined".',
  config        = $cfg${
    "response_patterns": [
      "\\breport(?:ed|s)?\\b",
      "\\bdemonstrat(?:ed|es|ing)?\\b",
      "\\bengag(?:ed|es|ing)?\\b",
      "\\bdeclin(?:ed|es|ing)?\\b",
      "\\bexpress(?:ed|es|ing)?\\b",
      "\\bstat(?:ed|es|ing)?\\b",
      "\\bindicated\\b",
      "\\brespond(?:ed|s)?\\b",
      "\\bparticipat(?:ed|es|ing)?\\b",
      "\\bcommunicat(?:ed|es|ing)?\\b",
      "\\bverbalised\\b|\\bverbalized\\b",
      "\\bappear(?:ed|s)?\\b",
      "\\bobserv(?:ed|es|ing)?\\b",
      "\\bcomment(?:ed|s)?\\b"
    ]
  }$cfg$::jsonb
WHERE rule_code = 'R12';
