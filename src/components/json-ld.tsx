import { serializeJsonLd } from "@/lib/seo/structured-data";

/** Renders schema.org structured data in a script tag, safely escaped. */
export function JsonLd({ data }: { data: object | object[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
