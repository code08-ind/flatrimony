import { titled } from '../../../../../lib/metadata';
import { BudgetStep } from '../../../../../components/steps';

export const generateMetadata = titled('onboarding.budget.title');

export default function Page() {
  return <BudgetStep />;
}
