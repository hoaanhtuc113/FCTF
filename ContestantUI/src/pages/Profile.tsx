import { Layout } from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { Typography, Paper, Box } from '@mui/material';

export function Profile() {
  const { user } = useAuth();

  return (
    <Layout>
      <Typography variant="h4" className="font-bold text-gray-800 mb-4">
        Profile
      </Typography>
      <Paper className="p-6 rounded-2xl">
        <Box className="space-y-4">
          <div>
            <Typography className="text-sm text-gray-500">Username</Typography>
            <Typography className="text-lg font-semibold">{user?.username}</Typography>
          </div>
          <div>
            <Typography className="text-sm text-gray-500">Email</Typography>
            <Typography className="text-lg font-semibold">{user?.email}</Typography>
          </div>
          <div>
            <Typography className="text-sm text-gray-500">Team</Typography>
            <Typography className="text-lg font-semibold">{user?.team.teamName}</Typography>
          </div>
          <div>
            <Typography className="text-sm text-gray-500">Team ID</Typography>
            <Typography className="text-lg font-semibold">{user?.team.id}</Typography>
          </div>
        </Box>
      </Paper>
    </Layout>
  );
}