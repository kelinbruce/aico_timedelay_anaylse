declare module 'fastify' {
  interface FastifyContextConfig {
    opLog?: {
      prefix: string;
      level: 'MINOR' | 'RISK';
      detailParams?: string[];
    };
  }
}

export {};
