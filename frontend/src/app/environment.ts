import { HttpInterceptorFn } from '@angular/common/http';

import { demoBackendInterceptor } from './demo/demo-backend';

/** This repository builds the static demo; it never calls a live Argowei API. */
export const DEMO_MODE = true;

export const backendInterceptors: HttpInterceptorFn[] = [demoBackendInterceptor];
