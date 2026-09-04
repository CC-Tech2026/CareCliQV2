import { useState } from "react";
import { EMPTY_ANSWERS, type Answers } from "./shared";
import { WelcomeStep } from "./WelcomeStep";
import { FeatureHighlightsStep } from "./FeatureHighlightsStep";
import { WhyCareCliqStep } from "./WhyCareCliqStep";
import { QuestionnaireStep } from "./QuestionnaireStep";
import { RecommendationStep } from "./RecommendationStep";
import { PricingStep, type PlanTier } from "./PricingStep";

type Step = 1 | 2 | 3 | 4 | 5 | 6;

export function GetStartedFlow() {
  const [step, setStep] = useState<Step>(1);
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [recommendedTier, setRecommendedTier] = useState<PlanTier | undefined>(undefined);

  function skipToPricing() {
    setRecommendedTier(undefined);
    setStep(6);
  }

  if (step === 1) return <WelcomeStep onContinue={() => setStep(2)} onSkip={skipToPricing} />;
  if (step === 2) return <FeatureHighlightsStep onContinue={() => setStep(3)} onSkip={skipToPricing} />;
  if (step === 3) return <WhyCareCliqStep onContinue={() => setStep(4)} onSkip={skipToPricing} />;
  if (step === 4) {
    return (
      <QuestionnaireStep
        answers={answers}
        onChange={setAnswers}
        onComplete={() => setStep(5)}
        onSkip={skipToPricing}
      />
    );
  }
  if (step === 5) {
    return (
      <RecommendationStep
        answers={answers}
        onContinueWithPlan={(tier) => {
          setRecommendedTier(tier);
          setStep(6);
        }}
        onSeeAllPlans={skipToPricing}
      />
    );
  }
  return <PricingStep recommendedTier={recommendedTier} />;
}
