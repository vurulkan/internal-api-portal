import type { ReactNode } from 'react';
import { AppBar, Box, Button, Drawer, List, ListItemButton, ListItemText, Toolbar, Typography } from '@mui/material';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';

type Props = {
  brandTitle: string;
  logoDataUrl?: string;
  username: string;
  isAdmin: boolean;
  canChangePassword: boolean;
  onLogout: () => void;
  children: ReactNode;
};

const drawerWidth = 280;

export function Layout({ brandTitle, logoDataUrl, username, isAdmin, canChangePassword, onLogout, children }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const navItems = [
    { label: 'API Catalog', path: '/' },
    ...(canChangePassword ? [{ label: 'Change Password', path: '/change-password' }] : []),
    ...(isAdmin ? [{ label: 'Admin', path: '/admin' }] : [])
  ];

  return (
    <Box display="flex">
      <AppBar position="fixed" sx={{ zIndex: 1201, background: '#fff', color: '#1a1a1a' }} elevation={1}>
        <Toolbar sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Box display="flex" gap={1.5} alignItems="center">
            {logoDataUrl ? <Box component="img" src={logoDataUrl} alt={brandTitle} sx={{ width: 32, height: 32, objectFit: 'contain' }} /> : null}
            <Typography variant="h6" fontWeight={600}>
              {brandTitle}
            </Typography>
          </Box>
          <Box display="flex" gap={2} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              {username}
            </Typography>
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                onLogout();
                navigate('/', { replace: true });
              }}
            >
              Sign out
            </Button>
          </Box>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            backgroundColor: '#0f1733',
            color: '#fff'
          }
        }}
      >
        <Toolbar />
        <Box sx={{ overflow: 'auto', px: 2, py: 3 }}>
          <Typography variant="caption" sx={{ textTransform: 'uppercase', color: '#9fb2ff' }}>
            Navigation
          </Typography>
          <List>
            {navItems.map((item) => (
              <ListItemButton
                key={item.path}
                component={RouterLink}
                to={item.path}
                selected={location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path))}
                sx={{
                  borderRadius: 1,
                  '&.Mui-selected': { backgroundColor: '#1b2d6b' },
                  '&.Mui-selected:hover': { backgroundColor: '#1b2d6b' }
                }}
              >
                <ListItemText primary={item.label} />
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: 3, minHeight: '100vh' }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}
