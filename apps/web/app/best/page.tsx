import { GuideIndex, guideIndexMetadata } from "../../components/guide-index";

export const revalidate = 3600;
export const metadata = guideIndexMetadata("best_of");

export default function Page() {
  return <GuideIndex type="best_of" />;
}
