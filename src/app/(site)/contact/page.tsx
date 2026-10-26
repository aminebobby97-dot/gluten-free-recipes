import { InfoPage } from "@/components/site/info-page";
import { siteConfig } from "@/lib/env";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: "Contact",
  description: `Get in touch with ${siteConfig.name} with recipe questions, corrections or partnership inquiries.`,
  path: "/contact",
});

export default function ContactPage() {
  return (
    <InfoPage title="Contact" path="/contact">
      <p>
        We welcome questions about our recipes, corrections and suggestions. If you spot an ingredient that may contain
        gluten, or an instruction that does not work as written, please let us know so we can review it.
      </p>
      {siteConfig.contactEmail ? (
        <p>
          Email us at <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>. We read every message,
          though we may not be able to reply to all of them.
        </p>
      ) : (
        <p>A contact email address will be available here soon.</p>
      )}
      <p>
        We cannot give personal medical or dietary advice. For questions about celiac disease or food allergies, please
        speak with your doctor or a registered dietitian.
      </p>
    </InfoPage>
  );
}
