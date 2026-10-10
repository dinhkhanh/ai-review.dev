import { GuideIndex, guideIndexMetadata } from "../../components/guide-index";

export const revalidate = 3600;
export const metadata = guideIndexMetadata("alternatives");

export default function Page() {
  return <GuideIndex type="alternatives" />;
}
