import { Routes } from '@angular/router';
export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'login', component: LoginComponent },
  { path: 'reports/:reportId', component: ReportComponent },
  { path: '**', redirectTo: '' },
];
