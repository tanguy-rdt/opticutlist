import { createRouter, createWebHashHistory, type Router, type RouterHistory } from 'vue-router'

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
      { path: '/projects', name: 'projects', component: ProjectsView },
      { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView },
    ],
  })
}
