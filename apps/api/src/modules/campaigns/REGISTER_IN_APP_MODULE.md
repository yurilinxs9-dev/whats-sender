# Register CampaignsModule in AppModule

Add the following import and registration to `apps/api/src/app.module.ts`:

```typescript
import { CampaignsModule } from './modules/campaigns/campaigns.module';
```

Then add `CampaignsModule` to the `imports` array:

```typescript
imports: [
  // ... existing imports
  CampaignsModule,
],
```
