import { useEffect, useState } from "react";
import { EMPTY_ANSWERS, StepNavContext, type Answers } from "./shared";
import { WelcomeStep } from "./WelcomeStep";
import { FeatureHighlightsStep } from "./FeatureHighlightsStep";
import { WhyCareCliqStep } from "./WhyCareCliqStep";
import { QuestionnaireStep } from "./QuestionnaireStep";
import { RecommendationStep } from "./RecommendationStep";
import { PricingStep, type PlanTier } from "./PricingStep";

type Step = 1 | 2 | 3 | 4 | 5 | 6;

export function GetStartedFlow() {
  // The steps the visitor actually went through, so Back after "Skip to
  // plans" returns to where they skipped from rather than an unseen step.
  const [history, setHistory] = useState<Step[]>([1]);
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [recommendedTier, setRecommendedTier] = useState<PlanTier | undefined>(undefined);
  const step = history[history.length - 1];

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  function go(next: Step) {
    setHistory((h) => [...h, next]);
  }

  function skipToPricing() {
    setRecommendedTier(undefined);
    go(6);
  }

  const back = history.length > 1 ? () => setHistory((h) => h.slice(0, -1)) : null;

  let content: React.ReactNode;
  if (step === 1) content = <WelcomeStep onContinue={() => go(2)} />;
  else if (step === 2) content = <FeatureHighlightsStep onContinue={() => go(3)} />;
  else if (step === 3) content = <WhyCareCliqStep onContinue={() => go(4)} />;
  else if (step === 4) {
    content = <QuestionnaireStep answers={answers} onChange={setAnswers} onComplete={() => go(5)} />;
  } else if (step === 5) {
    content = (
      <RecommendationStep
        answers={answers}
        onContinueWithPlan={(tier) => {
          setRecommendedTier(tier);
          go(6);
        }}
      />
    );
  } else content = <PricingStep recommendedTier={recommendedTier} />;

  return <StepNavContext.Provider value={{ back, skipToPricing }}>{content}</StepNavContext.Provider>;
}
