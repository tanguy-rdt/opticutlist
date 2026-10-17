import { createRouter, createWebHashHistory, type Router, type RouterHistory } from 'vue-router'

import StockView from '@/ui/pages/StockView.vue'
import ProjectPartsView from '@/ui/pages/ProjectPartsView.vue'
import ProjectWorkspace from '@/ui/layouts/ProjectWorkspace.vue'
import SuppliersView from '@/ui/pages/SuppliersView.vue'
import MaterialsView from '@/ui/pages/MaterialsView.vue'
import ProjectsView from '@/ui/pages/ProjectsView.vue'
import HomeView from '@/ui/pages/HomeView.vue'
import NotFoundView from '@/ui/pages/NotFoundView.vue'
import ProjectImport from '@/ui/pages/ProjectImport.vue'

const OptimizationView = () => import('@/ui/pages/OptimizationView.vue')

// Hash history keeps deep links working on static hosting (GitHub Pages).
export function createAppRouter(history: RouterHistory = createWebHashHistory()): Router {
  return createRouter({
    history,
    routes: [
      { path: '/', name: 'home', component: HomeView },
      { path: '/materials', redirect: '/projects' },
      { path: '/parts', redirect: '/projects' },
      { path: '/catalog', alias: '/suppliers', name: 'suppliers', component: SuppliersView },
      { path: '/stock', name: 'stock', component: StockView },
      { path: '/projects', name: 'projects', component: ProjectsView },
      { path: '/import', name: 'project-import', component: ProjectImport },
      {
        path: '/projects/:projectId', component: ProjectWorkspace, props: true, children: [
          { path: '', redirect: to => ({ name: 'project-materials', params: to.params }) },
          { path: 'parts', name: 'project-parts', component: ProjectPartsView },
          { path: 'materials', name: 'project-materials', component: MaterialsView },
          { path: 'optimization', name: 'project-optimization', component: OptimizationView, props: { cuttingPlansStep: false } },
          { path: 'stock', name: 'project-stock', component: () => import('@/ui/pages/ProjectStockView.vue') },
          {
            path: 'cutting-plans',
            alias: 'export',
            name: 'project-cutting-plans',
            component: OptimizationView,
            props: { cuttingPlansStep: true }
          },
        ]
      },
      { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView },
    ],
  })
}
