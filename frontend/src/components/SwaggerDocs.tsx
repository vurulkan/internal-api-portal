import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';
import '@/styles/swagger.css';
import type { SpecObject } from '@/lib/openapi';

/** Read-only Swagger UI (separate chunk; requests go through the try-it tab). */
export default function SwaggerDocs({ spec }: { spec: SpecObject }) {
  return (
    <div className="swagger-island">
      <SwaggerUI spec={spec} supportedSubmitMethods={[]} />
    </div>
  );
}
