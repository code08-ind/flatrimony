import { titled } from '../../../../../lib/metadata';
import { HabitsStep } from '../../../../../components/steps';

export const generateMetadata = titled('onboarding.habits.title');

export default function Page() {
  return <HabitsStep />;
}
