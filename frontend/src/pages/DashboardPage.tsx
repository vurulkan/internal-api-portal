import { Link } from 'react-router-dom';
import { Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { ApiSummary } from '../services/api';

type Props = {
  apis: ApiSummary[];
  refresh: () => void;
};

export function DashboardPage({ apis, refresh }: Props) {
  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={3}>
        <Box>
          <Typography variant="h4" fontWeight={600} gutterBottom>
            API Catalog
          </Typography>
          <Typography color="text.secondary">
            Only APIs granted through application permissions are listed here.
          </Typography>
        </Box>
        <Button variant="outlined" onClick={refresh}>Refresh</Button>
      </Box>
      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' }} gap={2}>
        {apis.map((api) => (
          <Box key={api.id}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
                  <Box>
                    <Typography variant="h6" fontWeight={600}>{api.name}</Typography>
                    <Typography variant="body2" color="text.secondary">{api.description || 'No description provided.'}</Typography>
                  </Box>
                  <Chip size="small" color={api.isActive ? 'success' : 'error'} label={api.isActive ? 'Active' : 'Inactive'} />
                </Box>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={2}>
                  {(api.tags ?? []).map((tag) => <Chip key={tag} size="small" variant="outlined" label={tag} />)}
                </Stack>
                <Typography variant="body2" color="text.secondary">Owner</Typography>
                <Typography mb={1.5}>{api.ownerTeam || 'Unassigned'}</Typography>
                <Typography variant="body2" color="text.secondary">Access</Typography>
                <Typography mb={2}>{api.canInvoke ? 'View + Invoke' : api.canView ? 'View only' : 'Restricted'}</Typography>
                <Button component={Link} to={`/apis/${api.id}`} variant="contained">Open</Button>
              </CardContent>
            </Card>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
