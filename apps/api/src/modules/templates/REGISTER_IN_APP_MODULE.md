# Register TemplatesModule in AppModule

Add the following import and module registration to `apps/api/src/app.module.ts`:

```typescript
// Add this import at the top:
import { TemplatesModule } from './modules/templates/templates.module';

// Add TemplatesModule to the imports array:
imports: [
  // ... existing modules
  TemplatesModule,
],
```
