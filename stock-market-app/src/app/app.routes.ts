import { Routes } from '@angular/router';
import { StockList } from './components/stock-list/stock-list';
import { StockDetail } from './components/stock-detail/stock-detail';
import { History } from './components/history/history';
import { Profile } from './components/profile/profile';
import { Login } from './components/login/login';
import { Signup } from './components/signup/signup';
import { ForgotPassword } from './components/forgot-password/forgot-password';
import { ResetPassword } from './components/reset-password/reset-password';
import { DevDashboard } from './components/dev-dashboard/dev-dashboard';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'login', component: Login },
  { path: 'signup', component: Signup },
  { path: 'forgot-password', component: ForgotPassword },
  { path: 'reset-password', component: ResetPassword },
  {
    path: '',
    component: StockList,
    canActivate: [authGuard]
  },
  {
    path: 'stock/:symbol',
    component: StockDetail,
    canActivate: [authGuard]
  },
  {
    path: 'history',
    component: History,
    canActivate: [authGuard]
  },
  {
    path: 'profile',
    component: Profile,
    canActivate: [authGuard]
  },
  {
    path: 'dev',
    component: DevDashboard,
    canActivate: [authGuard]
  },
  { path: '**', redirectTo: 'login' }
];
