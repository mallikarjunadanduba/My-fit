import { PrismaClient } from '@prisma/client';
const url = process.argv[2];
const p = new PrismaClient({ datasourceUrl: url });
const time = async (label: string, n: number) => {
  const t = performance.now();
  await Promise.all(Array.from({ length: n }, () => p.$queryRaw`SELECT 1`));
  console.log(label, n, 'parallel:', Math.round(performance.now() - t), 'ms');
};
await time('cold', 1);
await time('warm-up', 8);
for (const n of [1, 3, 6]) await time('warm', n);
await p.$disconnect();
