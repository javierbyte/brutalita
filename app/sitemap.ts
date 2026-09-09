import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://brutalita.com/',
      changeFrequency: 'monthly',
      priority: 1,
    },
    {
      url: 'https://brutalita.com/demo',
      changeFrequency: 'monthly',
      priority: 0.8,
    },
  ];
}
