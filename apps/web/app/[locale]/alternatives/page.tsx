import { GuideIndex, guideIndexMetadata } from "../../../components/guide-index";

export const revalidate = 3600;

export function generateMetadata() {
  return guideIndexMetadata("alternatives");
}

export default function Page() {
  return <GuideIndex type="alternatives" />;
}
