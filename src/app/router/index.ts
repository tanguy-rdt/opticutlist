import { createRouter, createWebHashHistory, type Router, type RouterHistory } from 'vue-router'

import ProjectPartsView from '../../features/projects/ProjectPartsView.vue'
import ProjectWorkspace from '../../features/projects/ProjectWorkspace.vue'
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
      { path: '/materials', redirect: '/projects' },
      { path: '/parts', redirect: '/projects' },
      { path: '/catalog', alias: '/suppliers', name: 'suppliers', component: SuppliersView },
      { path: '/projects', name: 'projects', component: ProjectsView },
      { path: '/projects/:projectId', component: ProjectWorkspace, props: true, children: [
        { path: '', redirect: to => ({ name: 'project-parts', params: to.params }) },
        { path: 'parts', name: 'project-parts', component: ProjectPartsView },
        { path: 'materials', name: 'project-materials', component: MaterialsView },
      ] },
      { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView },
    ],
  })
}
