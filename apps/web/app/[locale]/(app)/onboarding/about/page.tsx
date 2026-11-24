import { titled } from '../../../../../lib/metadata';
import { AboutStep } from '../../../../../components/steps';

export const generateMetadata = titled('onboarding.about.title');

export default function Page() {
  return <AboutStep />;
}
