import { titled } from '../../../../../lib/metadata';
import { MoveInStep } from '../../../../../components/steps';

export const generateMetadata = titled('onboarding.moveIn.title');

export default function Page() {
  return <MoveInStep />;
}
