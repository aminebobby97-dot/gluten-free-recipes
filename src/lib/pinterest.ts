// Pinterest "Save" link. A plain link to Pinterest's pin builder: no
// third-party script is loaded and nothing is posted automatically.

export function pinterestSaveUrl({ url, media, description }: { url: string; media: string; description: string }): string {
  const params = new URLSearchParams({ url, media, description });
  return `https://www.pinterest.com/pin/create/button/?${params.toString()}`;
}
