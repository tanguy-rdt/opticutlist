import { createRouter, createWebHashHistory, type Router, type RouterHistory } from 'vue-router'

import PartsView from '../../features/parts/PartsView.vue'
import SuppliersView from '../../features/suppliers/SuppliersView.vue'
import MaterialsView from '../../features/materials/MaterialsView.vue'
import ProjectsView from '../views/ProjectsView.vue'
import HomeView from '../views/HomeView.vue'
import NotFoundView from '../views/NotFoundView.vue'

// Hash history keeps deep links working on static hosting (GitHub Pages).
export function createAppRouter(history: RouterHistory = createWebHashHistory()): Router {
  return createRouter({
    history,
    routes: [
      { path: '/', name: 'home', component: HomeView },
      { path: '/materials', name: 'materials', component: MaterialsView },
      { path: '/parts', name: 'parts', component: PartsView },
      { path: '/catalog', alias: '/suppliers', name: 'suppliers', component: SuppliersView },
      { path: '/projects', name: 'projects', component: ProjectsView },
      { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView },
    ],
  })
}
