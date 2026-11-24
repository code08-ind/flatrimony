import { titled } from '../../../../../lib/metadata';
import { CategoryStep } from '../../../../../components/steps';

export const generateMetadata = titled('onboarding.category.title');

export default function Page() {
  return <CategoryStep />;
}
