import { GuideIndex, guideIndexMetadata } from "../../components/guide-index";

export const revalidate = 3600;
export const metadata = guideIndexMetadata("comparison");

export default function Page() {
  return <GuideIndex type="comparison" />;
}
