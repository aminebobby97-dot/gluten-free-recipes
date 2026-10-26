import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";

export interface Crumb {
  name: string;
  href: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="print-hidden">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-faint">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={item.href} className="flex items-center gap-1">
              {last ? (
                <span aria-current="page" className="text-ink-soft">
                  {item.name}
                </span>
              ) : (
                <>
                  <Link href={item.href} className="hover:text-sage-dark">
                    {item.name}
                  </Link>
                  <ChevronRightIcon size={14} />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
