import { titled } from '../../../../../lib/metadata';
import { IntentStep } from '../../../../../components/steps';

export const generateMetadata = titled('onboarding.intent.title');

export default function Page() {
  return <IntentStep />;
}
