import { titled } from '../../../../../lib/metadata';
import { CommuteStep } from '../../../../../components/steps';

export const generateMetadata = titled('anchor.title');

export default function Page() {
  return <CommuteStep />;
}
