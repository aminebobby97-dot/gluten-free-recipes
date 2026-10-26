import { InfoPage } from "@/components/site/info-page";
import { siteConfig } from "@/lib/env";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: "Privacy Policy",
  description: `How ${siteConfig.name} collects, uses and protects information when you visit the website.`,
  path: "/privacy-policy",
});

export default function PrivacyPolicyPage() {
  return (
    <InfoPage title="Privacy Policy" path="/privacy-policy">
      <p>
        This policy explains what information {siteConfig.name} collects when you use this website and how it is used.
        Please review it with a qualified advisor before relying on it for your own legal obligations.
      </p>
      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Recipe view counts.</strong> When you open a recipe, your browser sends an anonymous request that adds one
          to that recipe&apos;s view count. We store only the total count per recipe, not who viewed it. A small flag is kept
          in your browser&apos;s session storage so the same visit is not counted twice.
        </li>
        <li>
          <strong>Server logs.</strong> Our hosting providers may automatically record technical information such as IP
          address, browser type and the pages requested, to keep the site secure and running.
        </li>
        <li>
          <strong>Messages you send us.</strong> If you email us, we receive your email address and message.
        </li>
      </ul>
      <h2>Cookies</h2>
      <p>
        The public website does not set advertising or tracking cookies. Cookies are only used to keep site administrators
        signed in to the private dashboard.
      </p>
      <h2>Third-party services</h2>
      <p>
        The site is hosted on Vercel and uses Supabase for its database and image storage. If you use the Pinterest Save
        button, you leave our site and Pinterest&apos;s own privacy policy applies.
      </p>
      <h2>Changes</h2>
      <p>
        If we add analytics, advertising or newsletters in the future, we will update this policy before doing so.
      </p>
      {siteConfig.contactEmail && (
        <p>
          Questions about privacy can be sent to <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>.
        </p>
      )}
    </InfoPage>
  );
}
